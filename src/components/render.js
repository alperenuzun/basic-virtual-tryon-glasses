import * as THREE from 'three';

// ── State ──────────────────────────────────────────────────────────────────────
var faceLandmarker;
var glassesObj;
var faceObj; // dynamic face mesh occluder
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

// Face oval contour (36 landmarks tracing the face outline)
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

// ── Calibration ────────────────────────────────────────────────────────────────
const CFG = {
    refHeadWidth: 140,
    refFaceHeight: 210,
    glassesDepth: 10,
    glassesDown: 2,
    glassesCenterX: 0,
    glassesScale: 1.05
};

// ── Smoothing State ────────────────────────────────────────────────────────────
const sm = {
    ready: false,
    gPos: new THREE.Vector3(),
    gQuat: new THREE.Quaternion(),
    gScale: new THREE.Vector3(1, 1, 1),
    prev: new THREE.Vector3()
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function toV(pts, i) {
    return new THREE.Vector3(-pts[i][0], -pts[i][1], -pts[i][2]);
}

function mid(a, b) { return a.clone().add(b).multiplyScalar(0.5); }

function eyeMid(pts, inner, outer) {
    return mid(toV(pts, inner), toV(pts, outer));
}

function qDelta(a, b) {
    return 2 * Math.acos(clamp(Math.abs(a.dot(b)), 0, 1));
}

function toPixels(landmarks) {
    var w = video.videoWidth, h = video.videoHeight;
    return landmarks.map(function(l) { return [l.x * w, l.y * h, l.z * w]; });
}

// ── Rounded Rect Helpers ───────────────────────────────────────────────────────
function rrShape(w, h, r, oy) {
    oy = oy || 0;
    var s = new THREE.Shape();
    var x0 = -w / 2, x1 = w / 2;
    var y0 = -h / 2 + oy, y1 = h / 2 + oy;
    r = Math.min(r, w / 2, h / 2);
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r);
    s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
}

function rrPath(w, h, r, oy) {
    oy = oy || 0;
    var p = new THREE.Path();
    var x0 = -w / 2, x1 = w / 2;
    var y0 = -h / 2 + oy, y1 = h / 2 + oy;
    r = Math.min(r, w / 2, h / 2);
    p.moveTo(x0 + r, y0);
    p.lineTo(x1 - r, y0);
    p.quadraticCurveTo(x1, y0, x1, y0 + r);
    p.lineTo(x1, y1 - r);
    p.quadraticCurveTo(x1, y1, x1 - r, y1);
    p.lineTo(x0 + r, y1);
    p.quadraticCurveTo(x0, y1, x0, y1 - r);
    p.lineTo(x0, y0 + r);
    p.quadraticCurveTo(x0, y0, x0 + r, y0);
    return p;
}

// ── Sunglasses Model ───────────────────────────────────────────────────────────
function createSunglasses() {
    var g = new THREE.Group();

    // Dimensions (model units ~ mm)
    var lensW = 58, lensH = 34;
    var ftTop = 8, ftBot = 3, ftSide = 4;
    var bridgeW = 14, fd = 6;
    var tLen = 50, tW = 4.5, tH = 3;
    var lensR = 5, frameR = 6;

    // Materials
    var frameMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a12,
        metalness: 0.25,
        roughness: 0.25,
        side: THREE.FrontSide
    });

    var lensMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        metalness: 0.1,
        roughness: 0.05,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    // Frame outer shape with lens hole
    var oW = lensW + ftSide * 2;
    var oH = lensH + ftTop + ftBot;
    var vOff = (ftTop - ftBot) / 2;

    var outer = rrShape(oW, oH, frameR, vOff);
    outer.holes.push(rrPath(lensW, lensH, lensR));

    var extOpts = {
        depth: fd,
        bevelEnabled: true,
        bevelThickness: 0.8,
        bevelSize: 0.6,
        bevelSegments: 2
    };

    var fGeom = new THREE.ExtrudeBufferGeometry(outer, extOpts);
    fGeom.computeVertexNormals();

    var cx = bridgeW / 2 + oW / 2;

    // Left & Right frames
    var lf = new THREE.Mesh(fGeom, frameMat);
    lf.position.set(-cx, 0, -fd / 2);
    var rf = new THREE.Mesh(fGeom.clone(), frameMat);
    rf.position.set(cx, 0, -fd / 2);

    // Lenses
    var lGeom = new THREE.ShapeBufferGeometry(rrShape(lensW - 0.5, lensH - 0.5, lensR - 0.3), 12);
    var ll = new THREE.Mesh(lGeom, lensMat);
    ll.position.set(-cx, 0, 0.5);
    var rl = new THREE.Mesh(lGeom.clone(), lensMat);
    rl.position.set(cx, 0, 0.5);

    // Bridge
    var bGeo = new THREE.BoxBufferGeometry(bridgeW + ftSide, 3.5, fd * 0.7);
    var br = new THREE.Mesh(bGeo, frameMat);
    br.position.set(0, lensH * 0.15 + vOff, 0);

    // Temple arms - extend in -Z (behind the face)
    var tGeo = new THREE.BoxBufferGeometry(tW, tH, tLen);
    var tOutX = cx + oW / 2 - ftSide / 2;
    var tY = lensH * 0.15 + vOff;

    var tSplay = 0.08; // ~4.6° outward splay

    // Left temple (pivot at hinge, splay outward)
    var ltPivot = new THREE.Group();
    ltPivot.position.set(-tOutX, tY, -fd / 2);
    var lt = new THREE.Mesh(tGeo, frameMat);
    lt.position.set(0, 0, -tLen / 2);
    ltPivot.add(lt);
    ltPivot.rotation.y = -tSplay;

    // Right temple (pivot at hinge, splay outward)
    var rtPivot = new THREE.Group();
    rtPivot.position.set(tOutX, tY, -fd / 2);
    var rt = new THREE.Mesh(tGeo.clone(), frameMat);
    rt.position.set(0, 0, -tLen / 2);
    rtPivot.add(rt);
    rtPivot.rotation.y = tSplay;

    // Nose pads
    var npMat = new THREE.MeshStandardMaterial({
        color: 0xbbbbbb, metalness: 0, roughness: 0.6,
        transparent: true, opacity: 0.4
    });
    var npGeo = new THREE.SphereBufferGeometry(2.5, 8, 6);
    var lnp = new THREE.Mesh(npGeo, npMat);
    lnp.position.set(-bridgeW / 2 + 1, -lensH * 0.22, fd * 0.15);
    var rnp = new THREE.Mesh(npGeo, npMat);
    rnp.position.set(bridgeW / 2 - 1, -lensH * 0.22, fd * 0.15);

    // Assemble
    g.add(lf, rf, ll, rl, br, ltPivot, rtPivot, lnp, rnp);

    g.traverse(function(c) {
        if (c.isMesh) c.renderOrder = 3;
    });

    return g;
}

// ── Dynamic Face Mesh Occluder ─────────────────────────────────────────────────
function createDynamicFaceMesh() {
    // Triangle fan from 36 face oval landmarks + centroid center.
    // Vertices are updated each frame directly from landmark world coordinates.
    // No rigid transform needed — the mesh follows the face contour exactly.
    // This provides natural asymmetric occlusion: visible-side temple stays in
    // front of the face surface, hidden-side temple goes behind it.
    var nOval = FACE_OVAL.length;
    var nVerts = nOval + 1; // oval points + center

    var positions = new Float32Array(nVerts * 3);
    var indices = [];

    // Triangle fan: center (0) → oval[i] (i+1) → oval[next] (next+1)
    for (var i = 0; i < nOval; i++) {
        indices.push(0, i + 1, ((i + 1) % nOval) + 1);
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);

    var mat = new THREE.MeshBasicMaterial({
        colorWrite: false,
        side: THREE.DoubleSide
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    return mesh;
}

// ── Scene Setup ────────────────────────────────────────────────────────────────
function setVideoContent() {
    var vw = video.videoWidth;
    var vh = video.videoHeight;

    // Orthographic camera - no perspective distortion at edges
    camera = new THREE.OrthographicCamera(
        -vw / 2, vw / 2,
        vh / 2, -vh / 2,
        0.1, 5000
    );
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
    var key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(0, 100, 200);
    scene.add(key);

    var fill = new THREE.DirectionalLight(0xeeeeff, 0.45);
    fill.position.set(-80, 30, 100);
    scene.add(fill);

    var rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(60, 60, -80);
    scene.add(rim);

    var amb = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    scene.add(amb);
}

// ── Initialization ─────────────────────────────────────────────────────────────
export function IntializeThreejs(objName) {
    video = document.getElementById('tryon-video');
    container = document.getElementById('threejsContainer');

    setVideoContent();
    setTheLights();

    // Dynamic face mesh occluder (vertices updated each frame from landmarks)
    faceObj = createDynamicFaceMesh();
    faceObj.visible = false;
    scene.add(faceObj);

    // Procedural sunglasses
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
    var vw = video.videoWidth, vh = video.videoHeight;
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
        if (faceObj) faceObj.visible = true;

        var pts = toPixels(results.faceLandmarks[0]);

        // Key landmarks
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

        // Face measurements
        var eW = lEye.distanceTo(rEye);
        var tW = lTmp.distanceTo(rTmp);
        var cW = lChk.distanceTo(rChk);
        var fW = Math.max(eW, tW, cW);
        var fH = fHead.distanceTo(chn);

        // ── Orientation (landmark-based only) ──
        var xAxis = rEye.clone().sub(lEye).normalize();
        var yRaw = fHead.clone().sub(chn).normalize();
        var zAxis = xAxis.clone().cross(yRaw).normalize();

        // Ensure zAxis points toward camera (+Z in scene space)
        if (zAxis.z < 0) zAxis.negate();

        var yAxis = zAxis.clone().cross(xAxis).normalize();

        var rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        var targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat);

        // Glasses need Z-flip (model is upside-down without it)
        var flipZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
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

        // Apply to glasses
        glassesObj.position.copy(sm.gPos);
        glassesObj.quaternion.copy(sm.gQuat);
        glassesObj.scale.copy(sm.gScale);
        glassesObj.updateWorldMatrix(true, true);

        // Update dynamic face mesh vertices from landmarks
        if (faceObj) {
            var posAttr = faceObj.geometry.getAttribute('position');
            var cx = 0, cy = 0, cz = 0;
            var fwdOff = 8; // push mesh in front of temple hinge line
            for (var fi = 0; fi < FACE_OVAL.length; fi++) {
                var fv = toV(pts, FACE_OVAL[fi]);
                fv.addScaledVector(zAxis, fwdOff);
                posAttr.setXYZ(fi + 1, fv.x, fv.y, fv.z);
                cx += fv.x; cy += fv.y; cz += fv.z;
            }
            cx /= FACE_OVAL.length;
            cy /= FACE_OVAL.length;
            cz /= FACE_OVAL.length;
            // Push center behind face to form cone → approximates head volume
            // Fixes: temples visible when tilting face down
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
