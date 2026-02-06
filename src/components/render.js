import * as THREE from 'three';

// ── State ──────────────────────────────────────────────────────────────────────
var faceLandmarker;
var glassesObj;
var headOccluder;
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

// ── Calibration Config ───────────────────────────────────────────────────────
const CONFIG = {
    glassesDepthOffset: 12,
    glassesVerticalOffset: 2,
    glassesCenterX: 0,
    occluderDepthOffset: -0.4,
    occluderScaleX: 0.55,
    occluderScaleY: 0.52,
    occluderScaleZ: 0.45,
    occluderVerticalOffset: -5,
    referenceHeadWidth: 140,
    referenceFaceHeight: 210,
    glassesScaleMultiplier: 1.05
};

// ── Smoothing State ────────────────────────────────────────────────────────────
const smoothing = {
    ready: false,
    glassesPos: new THREE.Vector3(),
    glassesQuat: new THREE.Quaternion(),
    glassesScale: new THREE.Vector3(1, 1, 1),
    occluderPos: new THREE.Vector3(),
    occluderQuat: new THREE.Quaternion(),
    occluderScale: new THREE.Vector3(1, 1, 1),
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

// ── Procedural Sunglasses Model ──────────────────────────────────────────────

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

function createSunglasses() {
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
        color: 0x0a0a12,
        metalness: 0.25,
        roughness: 0.25,
        side: THREE.FrontSide
    });

    var lensMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        metalness: 0.1,
        roughness: 0.05,
        transparent: true,
        opacity: 0.55,
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

    // ── Temple Arms (extending in -Z direction = behind the head) ──
    var templeGeo = new THREE.BoxBufferGeometry(templeW, templeH, templeLen);

    var templeOuterX = lensCenterX + outerW / 2 - frameSideThick / 2;
    var ty = lensH * 0.18 + vertOff;

    var leftTemple = new THREE.Mesh(templeGeo, frameMat);
    leftTemple.position.set(-templeOuterX, ty, -(frameDepth / 2 + templeLen / 2));

    var rightTemple = new THREE.Mesh(templeGeo.clone(), frameMat);
    rightTemple.position.set(templeOuterX, ty, -(frameDepth / 2 + templeLen / 2));

    // ── Temple End Curves (ear hooks) ──
    var hookGeo = new THREE.BoxBufferGeometry(templeW, templeH * 2, templeH * 3);

    var leftHook = new THREE.Mesh(hookGeo, frameMat);
    leftHook.position.set(-templeOuterX, ty - templeH, -(frameDepth / 2 + templeLen + templeH));

    var rightHook = new THREE.Mesh(hookGeo.clone(), frameMat);
    rightHook.position.set(templeOuterX, ty - templeH, -(frameDepth / 2 + templeLen + templeH));

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

// ── Head Occluder ────────────────────────────────────────────────────────────

function createHeadOccluder() {
    var geo = new THREE.SphereBufferGeometry(1, 20, 16);
    var mat = new THREE.MeshBasicMaterial({
        colorWrite: false,
        side: THREE.FrontSide
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    return mesh;
}

// ── Scene Setup ────────────────────────────────────────────────────────────────

function setVideoContent() {
    var vw = video.videoWidth;
    var vh = video.videoHeight;

    // OrthographicCamera eliminates perspective distortion at edges
    camera = new THREE.OrthographicCamera(-vw / 2, vw / 2, vh / 2, -vh / 2, 0.1, 5000);
    camera.position.set(-vw / 2, -vh / 2, 500);

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
    var keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(0, 100, 150);
    scene.add(keyLight);

    var fillLight = new THREE.DirectionalLight(0xeeeeff, 0.45);
    fillLight.position.set(-80, 30, 100);
    scene.add(fillLight);

    var rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(60, 60, -80);
    scene.add(rimLight);

    var ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    scene.add(ambientLight);
}

// ── Initialization ─────────────────────────────────────────────────────────────

export function IntializeThreejs(objName) {
    video = document.getElementById('tryon-video');
    container = document.getElementById('threejsContainer');

    setVideoContent();
    setTheLights();

    // Create head occluder (replaces facemesh.obj)
    headOccluder = createHeadOccluder();
    headOccluder.visible = false;
    scene.add(headOccluder);

    // Create procedural sunglasses
    glassesObj = createSunglasses();
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
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    camera.left = -vw / 2;
    camera.right = vw / 2;
    camera.top = vh / 2;
    camera.bottom = -vh / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(windowWidth, windowWidth * vh / vw);
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
        outputFacialTransformationMatrixes: false
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
        if (headOccluder) headOccluder.visible = true;

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

        // ── Orientation from Landmarks Only ──
        var xAxis = rightEye.clone().sub(leftEye).normalize();
        var yAxisRaw = forehead.clone().sub(chin).normalize();
        var zAxis = xAxis.clone().cross(yAxisRaw).normalize();

        // Ensure zAxis points toward camera
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

        // Build rotation from landmark basis
        var rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        var targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat);

        // ── Position ──
        var bridgeToTip = noseTip.clone().sub(noseBridge);
        var depthAdjust = clamp(bridgeToTip.length() * 0.1, 0, 6);

        var targetGlassesPos = eyeMid.clone()
            .addScaledVector(xAxis, CONFIG.glassesCenterX)
            .addScaledVector(yAxis, CONFIG.glassesVerticalOffset)
            .addScaledVector(zAxis, CONFIG.glassesDepthOffset + depthAdjust);

        // ── Occluder Position ──
        var targetOccluderPos = eyeMid.clone()
            .addScaledVector(yAxis, CONFIG.occluderVerticalOffset)
            .addScaledVector(zAxis, faceWidth * CONFIG.occluderDepthOffset);

        var targetOccluderScale = new THREE.Vector3(
            faceWidth * CONFIG.occluderScaleX,
            faceHeight * CONFIG.occluderScaleY,
            faceWidth * CONFIG.occluderScaleZ
        );

        // ── Scale ──
        var widthScale = faceWidth / CONFIG.referenceHeadWidth;
        var heightScale = faceHeight / CONFIG.referenceFaceHeight;
        var baseScale = (widthScale * 0.7) + (heightScale * 0.3);

        var glassesScale = baseScale * CONFIG.glassesScaleMultiplier;

        var targetGlassesScale = new THREE.Vector3(
            glassesScale,
            glassesScale,
            glassesScale
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
            smoothing.occluderPos.copy(targetOccluderPos);
            smoothing.occluderQuat.copy(targetQuat);
            smoothing.occluderScale.copy(targetOccluderScale);
            smoothing.ready = true;
        } else {
            smoothing.glassesPos.lerp(targetGlassesPos, alphaPos);
            smoothing.glassesQuat.slerp(targetQuat, alphaRot);
            smoothing.glassesScale.lerp(targetGlassesScale, alphaScale);

            smoothing.occluderPos.lerp(targetOccluderPos, alphaPos);
            smoothing.occluderQuat.slerp(targetQuat, alphaRot);
            smoothing.occluderScale.lerp(targetOccluderScale, alphaScale);
        }

        smoothing.prevTargetPos.copy(targetGlassesPos);

        // ── Apply to Glasses ──
        glassesObj.position.copy(smoothing.glassesPos);
        glassesObj.quaternion.copy(smoothing.glassesQuat);
        glassesObj.scale.copy(smoothing.glassesScale);
        glassesObj.updateWorldMatrix(true, true);

        // ── Apply to Head Occluder ──
        if (headOccluder) {
            headOccluder.position.copy(smoothing.occluderPos);
            headOccluder.quaternion.copy(smoothing.occluderQuat);
            headOccluder.scale.copy(smoothing.occluderScale);
            headOccluder.updateWorldMatrix(true, true);
        }

    } else {
        if (glassesObj) glassesObj.visible = false;
        if (headOccluder) headOccluder.visible = false;
        smoothing.ready = false;
    }

    predictionInFlight = false;
    scheduleNextPrediction();
}
