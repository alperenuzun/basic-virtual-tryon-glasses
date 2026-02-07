/**
 * Virtual Try-On Engine
 *
 * Orchestrates the Three.js scene, MediaPipe face tracking, and per-frame
 * glasses placement. All shared state lives in this module; sub-modules
 * (glasses, occluder, scene, helpers) are stateless factories.
 *
 * Public API:
 *   initializeThreejs(objName) — set up scene, camera, models
 *   initializeEngine()         — load MediaPipe and start prediction loop
 */

import * as THREE from 'three';
import { CFG, LM, FACE_OVAL } from './constants';
import { clamp, toV, mid, eyeMid, qDelta, toPixels } from './helpers';
import { createSunglasses } from './glasses';
import { createDynamicFaceMesh } from './occluder';
import { createCamera, createVideoBackground, createLights, createRenderer, handleResize } from './scene';

// ── Private State ────────────────────────────────────────────────────────────
var faceLandmarker;
var glassesObj;
var faceObj;
var bg;
var video;
var renderer;
var camera;
var scene;
let predictionInFlight = false;

const sm = {
    ready: false,
    gPos: new THREE.Vector3(),
    gQuat: new THREE.Quaternion(),
    gScale: new THREE.Vector3(1, 1, 1),
    prev: new THREE.Vector3()
};

// ── Animation Loop ───────────────────────────────────────────────────────────
function animate() {
    bg.needsUpdate = true;
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// ── Public: Initialize Three.js Scene ────────────────────────────────────────
export function initializeThreejs(objName) {
    video = document.getElementById('tryon-video');
    var container = document.getElementById('threejsContainer');

    // Camera
    camera = createCamera(video);

    // Video background
    var bgResult = createVideoBackground(video, camera);
    bg = bgResult.bg;

    // Scene
    scene = new THREE.Scene();
    scene.add(bgResult.sprite);

    // Lights
    createLights().forEach(function(light) { scene.add(light); });

    // Face mesh occluder
    faceObj = createDynamicFaceMesh();
    faceObj.visible = false;
    scene.add(faceObj);

    // Glasses model
    glassesObj = createSunglasses();
    glassesObj.visible = false;
    scene.add(glassesObj);

    // Renderer
    renderer = createRenderer(video);
    container.appendChild(renderer.domElement);

    window.addEventListener('resize', function() {
        handleResize(camera, renderer, video);
    }, false);

    animate();
}

// ── Public: Initialize MediaPipe Face Tracking ───────────────────────────────
export async function initializeEngine() {
    var vision = await import(
        /* webpackIgnore: true */
        'https://unpkg.com/@mediapipe/tasks-vision@0.10.7/vision_bundle.mjs'
    );
    var fileset = await vision.FilesetResolver.forVisionTasks(
        'https://unpkg.com/@mediapipe/tasks-vision@0.10.7/wasm'
    );
    faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-assets/face_landmarker.task',
            delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false
    });
    scheduleNextPrediction();
}

// Backward-compatible aliases (legacy function names)
export { initializeThreejs as IntializeThreejs };
export { initializeEngine as IntializeEngine };

// ── Prediction Scheduling ────────────────────────────────────────────────────
function scheduleNextPrediction() {
    if (!video) {
        requestAnimationFrame(scheduleNextPrediction);
        return;
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(function() { renderPrediction(); });
    } else {
        requestAnimationFrame(renderPrediction);
    }
}

// ── Per-Frame Prediction ─────────────────────────────────────────────────────
function renderPrediction() {
    if (predictionInFlight) {
        scheduleNextPrediction();
        return;
    }
    predictionInFlight = true;

    if (!faceLandmarker) {
        predictionInFlight = false;
        scheduleNextPrediction();
        return;
    }

    var results = faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks && results.faceLandmarks.length > 0 && glassesObj) {
        glassesObj.visible = true;
        if (faceObj) faceObj.visible = true;

        var pts = toPixels(results.faceLandmarks[0], video);

        // ── Key landmarks ──
        var lEye = eyeMid(pts, LM.leftEyeInner, LM.leftEyeOuter);
        var rEye = eyeMid(pts, LM.rightEyeInner, LM.rightEyeOuter);
        var nose = toV(pts, LM.noseBridge);
        var nTip = toV(pts, LM.noseTip);
        var fHead = toV(pts, LM.forehead);
        var chn = toV(pts, LM.chin);
        var lTmp = toV(pts, LM.leftTemple);
        var rTmp = toV(pts, LM.rightTemple);
        var lChk = toV(pts, LM.leftCheek);
        var rChk = toV(pts, LM.rightCheek);

        var eMid = mid(lEye, rEye);

        // ── Face measurements ──
        var eW = lEye.distanceTo(rEye);
        var tW = lTmp.distanceTo(rTmp);
        var cW = lChk.distanceTo(rChk);
        var fW = Math.max(eW, tW, cW);
        var fH = fHead.distanceTo(chn);

        // ── Orientation (landmark-based) ──
        var xAxis = rEye.clone().sub(lEye).normalize();
        var yRaw = fHead.clone().sub(chn).normalize();
        var zAxis = xAxis.clone().cross(yRaw).normalize();

        if (zAxis.z < 0) zAxis.negate();

        var yAxis = zAxis.clone().cross(xAxis).normalize();

        var rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        var targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat);

        // Z-flip (model faces +Z but scene uses -Z for "behind")
        var flipZ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), Math.PI
        );
        targetQuat.multiply(flipZ);

        // ── Position ──
        var btt = nTip.clone().sub(nose);
        var depAdj = clamp(btt.length() * 0.1, 0, 6);

        var tGPos = eMid.clone()
            .addScaledVector(xAxis, CFG.glassesCenterX)
            .addScaledVector(yAxis, CFG.glassesDown)
            .addScaledVector(zAxis, CFG.glassesDepth + depAdj);

        // ── Scale ──
        var wS = fW / CFG.refHeadWidth;
        var hS = fH / CFG.refFaceHeight;
        var bS = (wS * 0.7) + (hS * 0.3);
        var gS = bS * CFG.glassesScale;

        var tGScale = new THREE.Vector3(gS, gS, gS);

        // ── Adaptive smoothing ──
        var mov = tGPos.distanceTo(sm.prev);
        var aDelta = qDelta(sm.gQuat, targetQuat);

        var aP = clamp(0.12 + mov * 0.012, 0.12, 0.5);
        var aR = clamp(0.12 + aDelta * 0.4, 0.12, 0.55);
        var aS = clamp(0.14 + mov * 0.008, 0.14, 0.4);

        if (!sm.ready) {
            sm.gPos.copy(tGPos);
            sm.gQuat.copy(targetQuat);
            sm.gScale.copy(tGScale);
            sm.ready = true;
        } else {
            sm.gPos.lerp(tGPos, aP);
            sm.gQuat.slerp(targetQuat, aR);
            sm.gScale.lerp(tGScale, aS);
        }

        sm.prev.copy(tGPos);

        // ── Apply to glasses ──
        glassesObj.position.copy(sm.gPos);
        glassesObj.quaternion.copy(sm.gQuat);
        glassesObj.scale.copy(sm.gScale);
        glassesObj.updateWorldMatrix(true, true);

        // ── Update face mesh occluder ──
        if (faceObj) {
            var posAttr = faceObj.geometry.getAttribute('position');
            var cx = 0, cy = 0, cz = 0;
            var fwdOff = 8;
            for (var fi = 0; fi < FACE_OVAL.length; fi++) {
                var fv = toV(pts, FACE_OVAL[fi]);
                fv.addScaledVector(zAxis, fwdOff);
                posAttr.setXYZ(fi + 1, fv.x, fv.y, fv.z);
                cx += fv.x; cy += fv.y; cz += fv.z;
            }
            cx /= FACE_OVAL.length;
            cy /= FACE_OVAL.length;
            cz /= FACE_OVAL.length;

            var coneD = fW * 0.5;
            posAttr.setXYZ(0,
                cx - zAxis.x * coneD,
                cy - zAxis.y * coneD,
                cz - zAxis.z * coneD
            );
            posAttr.needsUpdate = true;
        }

    } else {
        if (glassesObj) glassesObj.visible = false;
        if (faceObj) faceObj.visible = false;
        sm.ready = false;
    }

    predictionInFlight = false;
    scheduleNextPrediction();
}
