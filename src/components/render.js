import * as THREE from 'three';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader';

// ── State ──────────────────────────────────────────────────────────────────────
var faceLandmarker;
var glassesObj;
var faceObj;
var bg;
var video;
let renderer;
let camera;
var container;
let scene;
let videoSprite;
let windowWidth = 640;
let predictionInFlight = false;

// ── Landmark Indices ───────────────────────────────────────────────────────────
const LM = {
    leftEyeOuter: 33,
    rightEyeOuter: 263,
    leftEyeInner: 133,
    rightEyeInner: 362,
    leftTemple: 127,
    rightTemple: 356,
    leftCheek: 234,
    rightCheek: 454,
    forehead: 10,
    chin: 175,
    noseBridge: 168,
    noseTip: 1
};

// ── Calibration Metrics ────────────────────────────────────────────────────────
const MODEL_METRICS = {
    referenceHeadWidth: 140,
    referenceFaceHeight: 210,
    glassesDepth: 18,
    glassesDown: 4,
    glassesCenterX: 0,
    faceDepth: -4,
    glassesScaleMultiplier: 1.0,
    glassesModelWidth: 130,
    faceScaleBoost: 1.06,
    faceDepthBoost: 0.95
};

// ── Smoothing State ────────────────────────────────────────────────────────────
const smoothing = {
    ready: false,
    glassesPos: new THREE.Vector3(),
    glassesQuat: new THREE.Quaternion(),
    glassesScale: new THREE.Vector3(1, 1, 1),
    facePos: new THREE.Vector3(),
    faceQuat: new THREE.Quaternion(),
    faceScale: new THREE.Vector3(1, 1, 1),
    prevTargetPos: new THREE.Vector3()
};

// ── Helper Functions ───────────────────────────────────────────────────────────
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function toVec(points, idx) {
    return new THREE.Vector3(-points[idx][0], -points[idx][1], -points[idx][2]);
}

function mid(a, b) {
    return a.clone().add(b).multiplyScalar(0.5);
}

function eyeCenter(points, inner, outer) {
    return mid(toVec(points, inner), toVec(points, outer));
}

function quatDelta(a, b) {
    return 2 * Math.acos(clamp(Math.abs(a.dot(b)), 0, 1));
}

function lmToPixels(landmarks) {
    const w = video.videoWidth, h = video.videoHeight;
    return landmarks.map(l => [l.x * w, l.y * h, l.z * w]);
}

function computeNormal(v1, v2, v3) {
    const e1 = v2.clone().sub(v1);
    const e2 = v3.clone().sub(v1);
    return e1.cross(e2).normalize();
}

// ── Procedural Glasses Model ───────────────────────────────────────────────────

function createRoundedRectShape(w, h, r, offsetY) {
    offsetY = offsetY || 0;
    var shape = new THREE.Shape();
    var x0 = -w / 2, x1 = w / 2;
    var y0 = -h / 2 + offsetY, y1 = h / 2 + offsetY;
    r = Math.min(r, w / 2, h / 2);

    shape.moveTo(x0 + r, y0);
    shape.lineTo(x1 - r, y0);
    shape.quadraticCurveTo(x1, y0, x1, y0 + r);
    shape.lineTo(x1, y1 - r);
    shape.quadraticCurveTo(x1, y1, x1 - r, y1);
    shape.lineTo(x0 + r, y1);
    shape.quadraticCurveTo(x0, y1, x0, y1 - r);
    shape.lineTo(x0, y0 + r);
    shape.quadraticCurveTo(x0, y0, x0 + r, y0);

    return shape;
}

function createRoundedRectPath(w, h, r, offsetY) {
    offsetY = offsetY || 0;
    var path = new THREE.Path();
    var x0 = -w / 2, x1 = w / 2;
    var y0 = -h / 2 + offsetY, y1 = h / 2 + offsetY;
    r = Math.min(r, w / 2, h / 2);

    path.moveTo(x0 + r, y0);
    path.lineTo(x1 - r, y0);
    path.quadraticCurveTo(x1, y0, x1, y0 + r);
    path.lineTo(x1, y1 - r);
    path.quadraticCurveTo(x1, y1, x1 - r, y1);
    path.lineTo(x0 + r, y1);
    path.quadraticCurveTo(x0, y1, x0, y1 - r);
    path.lineTo(x0, y0 + r);
    path.quadraticCurveTo(x0, y0, x0 + r, y0);

    return path;
}

function createWayfarerGlasses() {
    var glasses = new THREE.Group();

    // ── Dimensions (model units ≈ mm) ──
    var lensW = 48;
    var lensH = 32;
    var frameTopThick = 7;
    var frameBotThick = 3;
    var frameSideThick = 4;
    var bridgeW = 16;
    var frameDepth = 6;
    var templeLen = 120;
    var templeW = 4.5;
    var templeH = 3;

    var lensCornerR = 4;
    var frameCornerR = 5;

    // ── Materials ──
    var frameMat = new THREE.MeshStandardMaterial({
        color: 0x111122,
        metalness: 0.2,
        roughness: 0.28,
        side: THREE.FrontSide
    });

    var lensMat = new THREE.MeshStandardMaterial({
        color: 0x556677,
        metalness: 0.15,
        roughness: 0.02,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    var nosePadMat = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.0,
        roughness: 0.6,
        transparent: true,
        opacity: 0.5
    });

    // ── Frame Shape (single lens frame with hole for lens) ──
    var outerW = lensW + frameSideThick * 2;
    var outerH = lensH + frameTopThick + frameBotThick;
    var vertOff = (frameTopThick - frameBotThick) / 2;

    var outerShape = createRoundedRectShape(outerW, outerH, frameCornerR, vertOff);
    var lensHole = createRoundedRectPath(lensW, lensH, lensCornerR);
    outerShape.holes.push(lensHole);

    var extrudeOpts = {
        depth: frameDepth,
        bevelEnabled: true,
        bevelThickness: 0.7,
        bevelSize: 0.5,
        bevelSegments: 2
    };

    var frameGeom = new THREE.ExtrudeBufferGeometry(outerShape, extrudeOpts);
    frameGeom.computeVertexNormals();

    // ── Left & Right Lens Frames ──
    var lensCenterX = bridgeW / 2 + outerW / 2;

    var leftFrame = new THREE.Mesh(frameGeom, frameMat);
    leftFrame.position.set(-lensCenterX, 0, -frameDepth / 2);

    var rightFrame = new THREE.Mesh(frameGeom.clone(), frameMat);
    rightFrame.position.set(lensCenterX, 0, -frameDepth / 2);

    // ── Lenses ──
    var lensShape = createRoundedRectShape(lensW - 0.5, lensH - 0.5, lensCornerR - 0.3);
    var lensGeom = new THREE.ShapeBufferGeometry(lensShape, 12);

    var leftLens = new THREE.Mesh(lensGeom, lensMat);
    leftLens.position.set(-lensCenterX, 0, 0);

    var rightLens = new THREE.Mesh(lensGeom.clone(), lensMat);
    rightLens.position.set(lensCenterX, 0, 0);

    // ── Bridge ──
    var bridgeGeo = new THREE.BoxBufferGeometry(bridgeW + frameSideThick, 3.5, frameDepth * 0.7);
    var bridge = new THREE.Mesh(bridgeGeo, frameMat);
    bridge.position.set(0, lensH * 0.18 + vertOff, 0);

    // ── Temple Arms ──
    var templeGeo = new THREE.BoxBufferGeometry(templeW, templeH, templeLen);

    var templeOuterX = lensCenterX + outerW / 2 - frameSideThick / 2;

    var leftTemple = new THREE.Mesh(templeGeo, frameMat);
    leftTemple.position.set(-templeOuterX, lensH * 0.18 + vertOff, templeLen / 2);

    var rightTemple = new THREE.Mesh(templeGeo.clone(), frameMat);
    rightTemple.position.set(templeOuterX, lensH * 0.18 + vertOff, templeLen / 2);

    // ── Temple End Curves (ear hooks) ──
    var hookGeo = new THREE.BoxBufferGeometry(templeW, templeH * 2, templeH * 3);

    var leftHook = new THREE.Mesh(hookGeo, frameMat);
    leftHook.position.set(-templeOuterX, lensH * 0.18 + vertOff - templeH, templeLen + templeH);

    var rightHook = new THREE.Mesh(hookGeo.clone(), frameMat);
    rightHook.position.set(templeOuterX, lensH * 0.18 + vertOff - templeH, templeLen + templeH);

    // ── Nose Pads ──
    var nosePadGeo = new THREE.SphereBufferGeometry(2.5, 8, 6);

    var leftNosePad = new THREE.Mesh(nosePadGeo, nosePadMat);
    leftNosePad.position.set(-bridgeW / 2 + 1, -lensH * 0.2, frameDepth * 0.1);

    var rightNosePad = new THREE.Mesh(nosePadGeo, nosePadMat);
    rightNosePad.position.set(bridgeW / 2 - 1, -lensH * 0.2, frameDepth * 0.1);

    // ── Assemble ──
    glasses.add(leftFrame, rightFrame);
    glasses.add(leftLens, rightLens);
    glasses.add(bridge);
    glasses.add(leftTemple, rightTemple);
    glasses.add(leftHook, rightHook);
    glasses.add(leftNosePad, rightNosePad);

    // Set render order for all meshes
    glasses.traverse(function(child) {
        if (child.isMesh) {
            child.renderOrder = 3;
        }
    });

    return glasses;
}

// ── Scene Setup ────────────────────────────────────────────────────────────────

function setVideoContent() {
    // Compute exact FOV to match video dimensions
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    var fov = 2 * Math.atan(0.5) * (180 / Math.PI); // ~53.13°

    camera = new THREE.PerspectiveCamera(fov, vw / vh, 1, 5000);
    camera.position.z = vh;
    camera.position.x = -vw / 2;
    camera.position.y = -vh / 2;

    bg = new THREE.Texture(video);
    bg.minFilter = THREE.LinearFilter;

    videoSprite = new THREE.Sprite(new THREE.MeshBasicMaterial({
        map: bg,
        depthWrite: false,
        side: THREE.DoubleSide
    }));

    scene = new THREE.Scene();
    scene.add(videoSprite);
    videoSprite.center.set(0.5, 0.5);
    videoSprite.scale.set(-vw, vh, 1);
    videoSprite.position.copy(camera.position);
    videoSprite.position.z = 0;
}

function setTheLights() {
    // Key light - main illumination from front-above
    var keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(0, 100, 150);
    scene.add(keyLight);

    // Fill light - soften shadows from the side
    var fillLight = new THREE.DirectionalLight(0xeeeeff, 0.45);
    fillLight.position.set(-80, 30, 100);
    scene.add(fillLight);

    // Rim light - subtle edge highlight
    var rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(60, 60, -80);
    scene.add(rimLight);

    // Ambient - overall soft illumination
    var ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    scene.add(ambientLight);
}

function getFaceMask() {
    new OBJLoader().load(process.env.PUBLIC_URL + '/obj/facemesh.obj', function(obj) {
        obj.traverse(function(child) {
            if (child instanceof THREE.Mesh) {
                faceObj = new THREE.Mesh(
                    child.geometry,
                    new THREE.MeshLambertMaterial({
                        side: THREE.FrontSide,
                        color: 0x0000ff,
                        colorWrite: false
                    })
                );
                faceObj.renderOrder = 5;
                scene.add(faceObj);
            }
        });
    });
}

// ── Initialization ─────────────────────────────────────────────────────────────

export function IntializeThreejs(objName) {
    video = document.getElementById('tryon-video');
    container = document.getElementById('threejsContainer');

    setVideoContent();
    setTheLights();

    getFaceMask();

    // Create procedural wayfarer glasses
    glassesObj = createWayfarerGlasses();
    glassesObj.visible = false;
    scene.add(glassesObj);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(windowWidth, windowWidth * video.videoHeight / video.videoWidth);
    renderer.physicallyCorrectLights = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputEncoding = THREE.sRGBEncoding;

    container.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    camera.aspect = video.videoWidth / video.videoHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(windowWidth, windowWidth * video.videoHeight / video.videoWidth);
}

function animate() {
    bg.needsUpdate = true;
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// ── MediaPipe Engine ───────────────────────────────────────────────────────────

export async function IntializeEngine() {
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
        outputFacialTransformationMatrixes: true
    });
    scheduleNextPrediction();
}

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

// ── Prediction Loop ────────────────────────────────────────────────────────────

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

        var points = lmToPixels(results.faceLandmarks[0]);

        // ── Extract Key Landmarks ──
        var leftEye = eyeCenter(points, LM.leftEyeInner, LM.leftEyeOuter);
        var rightEye = eyeCenter(points, LM.rightEyeInner, LM.rightEyeOuter);
        var noseBridge = toVec(points, LM.noseBridge);
        var noseTip = toVec(points, LM.noseTip);
        var forehead = toVec(points, LM.forehead);
        var chin = toVec(points, LM.chin);
        var leftTemple = toVec(points, LM.leftTemple);
        var rightTemple = toVec(points, LM.rightTemple);
        var leftCheek = toVec(points, LM.leftCheek);
        var rightCheek = toVec(points, LM.rightCheek);

        var eyeMid = mid(leftEye, rightEye);

        // ── Face Measurements ──
        var eyeWidth = leftEye.distanceTo(rightEye);
        var templeWidth = leftTemple.distanceTo(rightTemple);
        var cheekWidth = leftCheek.distanceTo(rightCheek);
        var faceWidth = Math.max(eyeWidth, templeWidth, cheekWidth);
        var faceHeight = forehead.distanceTo(chin);

        // ── Orientation from Landmarks ──
        var xAxis = rightEye.clone().sub(leftEye).normalize();
        var yAxisRaw = forehead.clone().sub(chin).normalize();
        var zAxis = xAxis.clone().cross(yAxisRaw).normalize();

        // Ensure zAxis points toward camera (positive z in scene ≈ toward camera)
        var faceNormal = computeNormal(
            toVec(points, LM.leftEyeOuter),
            toVec(points, LM.rightEyeOuter),
            toVec(points, LM.noseBridge)
        );
        if (zAxis.dot(faceNormal) < 0) {
            zAxis.negate();
        }

        // Recompute yAxis for perfect orthogonality
        var yAxis = zAxis.clone().cross(xAxis).normalize();

        // ── Use Transformation Matrix for Rotation (if available) ──
        var targetQuat;
        if (results.facialTransformationMatrixes &&
            results.facialTransformationMatrixes.length > 0) {
            var matData = results.facialTransformationMatrixes[0].data;
            // MediaPipe provides row-major 4x4 matrix
            // Convert to Three.js Matrix4 (column-major)
            var m = new THREE.Matrix4();
            m.set(
                matData[0], matData[1], matData[2], matData[3],
                matData[4], matData[5], matData[6], matData[7],
                matData[8], matData[9], matData[10], matData[11],
                matData[12], matData[13], matData[14], matData[15]
            );

            // Extract rotation
            var mpQuat = new THREE.Quaternion();
            var mpPos = new THREE.Vector3();
            var mpScale = new THREE.Vector3();
            m.decompose(mpPos, mpQuat, mpScale);

            // Convert from MediaPipe coords (X-right, Y-down, Z-forward)
            // to scene coords (X-neg-right, Y-neg-down, Z-neg-forward)
            // and apply mirror for the mirrored video display.
            // Mirror X-axis rotation: negate y and z components of quaternion
            targetQuat = new THREE.Quaternion(
                mpQuat.x,
                -mpQuat.y,
                -mpQuat.z,
                mpQuat.w
            );
        } else {
            // Fallback: compute from landmarks
            var rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
            targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat);
        }

        // ── Position ──
        var bridgeToTip = noseTip.clone().sub(noseBridge);
        var depthAdjust = clamp(bridgeToTip.length() * 0.1, 0, 6);

        var targetGlassesPos = eyeMid.clone()
            .addScaledVector(xAxis, MODEL_METRICS.glassesCenterX)
            .addScaledVector(yAxis, MODEL_METRICS.glassesDown)
            .addScaledVector(zAxis, MODEL_METRICS.glassesDepth + depthAdjust);

        var targetFacePos = noseBridge.clone()
            .addScaledVector(zAxis, MODEL_METRICS.faceDepth);

        // ── Scale ──
        var widthScale = faceWidth / MODEL_METRICS.referenceHeadWidth;
        var heightScale = faceHeight / MODEL_METRICS.referenceFaceHeight;
        var baseScale = (widthScale * 0.7) + (heightScale * 0.3);

        var glassesScale = baseScale * MODEL_METRICS.glassesScaleMultiplier;
        var faceScale = baseScale * MODEL_METRICS.faceScaleBoost;

        var targetGlassesScale = new THREE.Vector3(
            glassesScale,
            glassesScale,
            glassesScale
        );
        var targetFaceScale = new THREE.Vector3(
            faceScale,
            faceScale,
            faceScale * MODEL_METRICS.faceDepthBoost
        );

        // ── Adaptive Smoothing ──
        var movement = targetGlassesPos.distanceTo(smoothing.prevTargetPos);
        var angleDelta = quatDelta(smoothing.glassesQuat, targetQuat);

        var alphaPos = clamp(0.1 + movement * 0.012, 0.1, 0.5);
        var alphaRot = clamp(0.1 + angleDelta * 0.4, 0.1, 0.55);
        var alphaScale = clamp(0.12 + movement * 0.008, 0.12, 0.4);

        if (!smoothing.ready) {
            smoothing.glassesPos.copy(targetGlassesPos);
            smoothing.glassesQuat.copy(targetQuat);
            smoothing.glassesScale.copy(targetGlassesScale);
            smoothing.facePos.copy(targetFacePos);
            smoothing.faceQuat.copy(targetQuat);
            smoothing.faceScale.copy(targetFaceScale);
            smoothing.ready = true;
        } else {
            smoothing.glassesPos.lerp(targetGlassesPos, alphaPos);
            smoothing.glassesQuat.slerp(targetQuat, alphaRot);
            smoothing.glassesScale.lerp(targetGlassesScale, alphaScale);

            smoothing.facePos.lerp(targetFacePos, alphaPos);
            smoothing.faceQuat.slerp(targetQuat, alphaRot);
            smoothing.faceScale.lerp(targetFaceScale, alphaScale);
        }

        smoothing.prevTargetPos.copy(targetGlassesPos);

        // ── Apply to Objects ──
        glassesObj.position.copy(smoothing.glassesPos);
        glassesObj.quaternion.copy(smoothing.glassesQuat);
        glassesObj.scale.copy(smoothing.glassesScale);
        glassesObj.updateWorldMatrix(true, true);

        if (faceObj) {
            faceObj.position.copy(smoothing.facePos);
            faceObj.quaternion.copy(smoothing.faceQuat);
            faceObj.scale.copy(smoothing.faceScale);
            faceObj.updateWorldMatrix(true, true);
        }

    } else {
        if (glassesObj) glassesObj.visible = false;
        if (faceObj) faceObj.visible = false;
        smoothing.ready = false;
    }

    predictionInFlight = false;
    scheduleNextPrediction();
}
