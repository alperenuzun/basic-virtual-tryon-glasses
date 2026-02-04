import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ============================================
// STATE MANAGEMENT
// ============================================
let faceLandmarker = null;
let video = null;
let renderer = null;
let camera = null;
let scene = null;
let glassesGroup = null;
let faceOccluder = null;  // Dynamic face mesh for depth occlusion
let occluderGeometry = null;
let videoTexture = null;
let isRunning = false;
let lastVideoTime = -1;

// Face mesh triangulation indices (subset for face occlusion - covers main face area)
// These indices connect the 468 MediaPipe landmarks into triangles
const FACE_TRIANGLES = [
    // Forehead and upper face
    10, 338, 297, 10, 297, 332, 10, 332, 284, 10, 284, 251, 10, 251, 389,
    10, 389, 356, 10, 356, 454, 10, 454, 323, 10, 323, 361, 10, 361, 288,
    10, 288, 397, 10, 397, 365, 10, 365, 379, 10, 379, 378, 10, 378, 400,
    10, 400, 377, 10, 377, 152, 10, 152, 148, 10, 148, 176, 10, 176, 149,
    10, 149, 150, 10, 150, 136, 10, 136, 172, 10, 172, 58, 10, 58, 132,
    10, 132, 93, 10, 93, 234, 10, 234, 127, 10, 127, 162, 10, 162, 21,
    10, 21, 54, 10, 54, 103, 10, 103, 67, 10, 67, 109,
    // Left cheek
    234, 93, 132, 132, 58, 172, 172, 136, 150, 150, 149, 176, 176, 148, 152,
    // Right cheek
    454, 356, 389, 389, 251, 284, 284, 332, 297, 297, 338, 10,
    // Nose area
    1, 2, 98, 1, 98, 327, 2, 326, 327, 98, 2, 327,
    // Around eyes - left
    33, 246, 161, 161, 160, 159, 159, 158, 157, 157, 173, 133,
    33, 7, 163, 163, 144, 145, 145, 153, 154, 154, 155, 133,
    // Around eyes - right
    263, 466, 388, 388, 387, 386, 386, 385, 384, 384, 398, 362,
    263, 249, 390, 390, 373, 374, 374, 380, 381, 381, 382, 362,
    // Nose bridge
    6, 122, 188, 6, 188, 114, 6, 114, 245, 6, 245, 193,
    6, 351, 412, 6, 412, 343, 6, 343, 465, 6, 465, 417,
    // Lower face / jaw
    152, 377, 400, 400, 378, 379, 379, 365, 397, 397, 288, 361,
    361, 323, 454, 454, 356, 389, 389, 251, 284, 284, 332, 297,
    148, 176, 149, 149, 150, 136, 136, 172, 58, 58, 132, 93,
    93, 234, 127, 127, 162, 21, 21, 54, 103, 103, 67, 109,
    // Chin
    152, 148, 175, 175, 396, 377, 152, 175, 377,
    // Fill gaps
    168, 6, 197, 197, 195, 5, 5, 4, 1, 1, 19, 94,
    94, 2, 164, 164, 0, 267, 267, 269, 270, 270, 409, 291,
    291, 375, 321, 321, 405, 314, 314, 17, 84, 84, 181, 91,
    91, 146, 61, 61, 185, 40, 40, 39, 37, 37, 0, 267
];

// ============================================
// SMOOTHING SYSTEM - One Euro Filter inspired
// ============================================
class SmoothingFilter {
    constructor(smoothingFactor = 0.25) {
        this.smoothingFactor = smoothingFactor;
        this.position = null;
        this.rotation = null;
        this.scale = null;
    }

    update(newPosition, newRotation, newScale) {
        if (!this.position) {
            this.position = newPosition.clone();
            this.rotation = newRotation.clone();
            this.scale = newScale.clone();
            return { position: this.position, rotation: this.rotation, scale: this.scale };
        }

        // Smooth position
        this.position.lerp(newPosition, this.smoothingFactor);

        // Smooth rotation
        this.rotation.x += (newRotation.x - this.rotation.x) * this.smoothingFactor;
        this.rotation.y += (newRotation.y - this.rotation.y) * this.smoothingFactor;
        this.rotation.z += (newRotation.z - this.rotation.z) * this.smoothingFactor;

        // Smooth scale
        this.scale.lerp(newScale, this.smoothingFactor);

        return { position: this.position, rotation: this.rotation, scale: this.scale };
    }

    reset() {
        this.position = null;
        this.rotation = null;
        this.scale = null;
    }
}

const glassesFilter = new SmoothingFilter(0.35);

// ============================================
// 3D GLASSES MODEL - Realistic Aviator Style
// ============================================
function createGlassesModel() {
    // Outer group for positioning/rotation from face tracking
    const outerGroup = new THREE.Group();

    // Inner group for the actual glasses model
    // We use 180° Y rotation for visual appearance, but need temples to go
    // in +Z direction so after rotation they end up at -Z (away from camera)
    const group = new THREE.Group();

    // === MATERIALS ===
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x2c2c2c,
        metalness: 0.8,
        roughness: 0.3,
    });

    const lensMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x3d2817,
        transparent: true,
        opacity: 0.75,
        metalness: 0.1,
        roughness: 0.1,
        clearcoat: 0.3,
        side: THREE.DoubleSide,
    });

    const metalMaterial = new THREE.MeshStandardMaterial({
        color: 0x888888,
        metalness: 0.9,
        roughness: 0.2,
    });

    // === DIMENSIONS ===
    const lensWidth = 2.2;
    const lensHeight = 1.6;
    const lensSeparation = 0.5; // Gap between lenses (nose bridge area)
    const frameThickness = 0.08;
    const templeLength = 5.0; // Length going back towards ears

    // Lens X positions
    const leftLensX = -(lensWidth / 2 + lensSeparation / 2);
    const rightLensX = (lensWidth / 2 + lensSeparation / 2);

    // === CREATE AVIATOR LENS SHAPE ===
    function createAviatorLensShape(width, height) {
        const shape = new THREE.Shape();
        const w = width / 2;
        const h = height / 2;
        const r = 0.3; // Corner radius

        // Aviator style: wider at top, narrower at bottom with rounded corners
        shape.moveTo(-w + r, -h);
        shape.lineTo(w - r, -h);
        shape.quadraticCurveTo(w, -h, w, -h + r);
        shape.lineTo(w, h - r);
        shape.quadraticCurveTo(w, h, w - r, h);
        shape.lineTo(-w + r, h);
        shape.quadraticCurveTo(-w, h, -w, h - r);
        shape.lineTo(-w, -h + r);
        shape.quadraticCurveTo(-w, -h, -w + r, -h);

        return shape;
    }

    // === LEFT LENS ===
    const leftLensShape = createAviatorLensShape(lensWidth, lensHeight);
    const leftLensGeom = new THREE.ExtrudeGeometry(leftLensShape, {
        depth: 0.05,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2
    });
    const leftLens = new THREE.Mesh(leftLensGeom, lensMaterial);
    leftLens.position.set(leftLensX, 0, 0);
    group.add(leftLens);

    // === RIGHT LENS ===
    const rightLensGeom = new THREE.ExtrudeGeometry(leftLensShape, {
        depth: 0.05,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2
    });
    const rightLens = new THREE.Mesh(rightLensGeom, lensMaterial);
    rightLens.position.set(rightLensX, 0, 0);
    group.add(rightLens);

    // === FRAME RIMS ===
    function createFrameRim(lensShape, thickness) {
        const outerShape = new THREE.Shape();
        const w = lensWidth / 2 + thickness;
        const h = lensHeight / 2 + thickness;
        const r = 0.35;

        outerShape.moveTo(-w + r, -h);
        outerShape.lineTo(w - r, -h);
        outerShape.quadraticCurveTo(w, -h, w, -h + r);
        outerShape.lineTo(w, h - r);
        outerShape.quadraticCurveTo(w, h, w - r, h);
        outerShape.lineTo(-w + r, h);
        outerShape.quadraticCurveTo(-w, h, -w, h - r);
        outerShape.lineTo(-w, -h + r);
        outerShape.quadraticCurveTo(-w, -h, -w + r, -h);

        outerShape.holes.push(lensShape);
        return outerShape;
    }

    const leftFrameShape = createFrameRim(createAviatorLensShape(lensWidth - 0.02, lensHeight - 0.02), frameThickness);
    const leftFrameGeom = new THREE.ExtrudeGeometry(leftFrameShape, {
        depth: 0.12,
        bevelEnabled: false
    });
    const leftFrame = new THREE.Mesh(leftFrameGeom, frameMaterial);
    leftFrame.position.set(leftLensX, 0, -0.03);
    group.add(leftFrame);

    const rightFrameShape = createFrameRim(createAviatorLensShape(lensWidth - 0.02, lensHeight - 0.02), frameThickness);
    const rightFrameGeom = new THREE.ExtrudeGeometry(rightFrameShape, {
        depth: 0.12,
        bevelEnabled: false
    });
    const rightFrame = new THREE.Mesh(rightFrameGeom, frameMaterial);
    rightFrame.position.set(rightLensX, 0, -0.03);
    group.add(rightFrame);

    // === NOSE BRIDGE (connects the two lenses) ===
    // Bridge goes slightly forward (-Z) for proper depth after rotation
    const bridgeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(leftLensX + lensWidth / 2, 0.1, -0.05),
        new THREE.Vector3(0, 0.25, -0.15),
        new THREE.Vector3(rightLensX - lensWidth / 2, 0.1, -0.05)
    ]);
    const bridgeGeom = new THREE.TubeGeometry(bridgeCurve, 16, 0.06, 8, false);
    const bridge = new THREE.Mesh(bridgeGeom, frameMaterial);
    group.add(bridge);

    // === NOSE PADS ===
    const nosePadGeom = new THREE.SphereGeometry(0.1, 12, 12);

    const leftPadArm = new THREE.CatmullRomCurve3([
        new THREE.Vector3(leftLensX + lensWidth / 4, -0.2, -0.05),
        new THREE.Vector3(leftLensX + lensWidth / 4 + 0.15, -0.35, -0.2)
    ]);
    const leftPadArmGeom = new THREE.TubeGeometry(leftPadArm, 8, 0.03, 6, false);
    const leftPadArmMesh = new THREE.Mesh(leftPadArmGeom, metalMaterial);
    group.add(leftPadArmMesh);

    const leftNosePad = new THREE.Mesh(nosePadGeom, metalMaterial);
    leftNosePad.position.set(leftLensX + lensWidth / 4 + 0.15, -0.4, -0.25);
    leftNosePad.scale.set(0.8, 1.2, 0.4);
    group.add(leftNosePad);

    const rightPadArm = new THREE.CatmullRomCurve3([
        new THREE.Vector3(rightLensX - lensWidth / 4, -0.2, -0.05),
        new THREE.Vector3(rightLensX - lensWidth / 4 - 0.15, -0.35, -0.2)
    ]);
    const rightPadArmGeom = new THREE.TubeGeometry(rightPadArm, 8, 0.03, 6, false);
    const rightPadArmMesh = new THREE.Mesh(rightPadArmGeom, metalMaterial);
    group.add(rightPadArmMesh);

    const rightNosePad = new THREE.Mesh(nosePadGeom, metalMaterial);
    rightNosePad.position.set(rightLensX - lensWidth / 4 - 0.15, -0.4, -0.25);
    rightNosePad.scale.set(0.8, 1.2, 0.4);
    group.add(rightNosePad);

    // === TEMPLES (Arms) - Going in +Z direction ===
    // After 180° Y rotation, these will be at -Z (away from camera = behind face)
    // This is correct for depth occlusion to work properly
    const hingeY = lensHeight / 2 - 0.15;

    // Left temple - starts at left frame edge, goes in +Z direction (will become -Z after rotation)
    const leftHingeX = leftLensX - lensWidth / 2 - frameThickness;

    // Hinge connector
    const leftHingeGeom = new THREE.BoxGeometry(0.15, 0.2, 0.15);
    const leftHinge = new THREE.Mesh(leftHingeGeom, metalMaterial);
    leftHinge.position.set(leftHingeX, hingeY, 0);
    group.add(leftHinge);

    // Temple arm going in +Z direction (becomes -Z after rotation = towards ears)
    const leftTempleCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(leftHingeX, hingeY, 0.05),
        new THREE.Vector3(leftHingeX - 0.1, hingeY, templeLength * 0.4),
        new THREE.Vector3(leftHingeX - 0.15, hingeY - 0.1, templeLength * 0.7),
        new THREE.Vector3(leftHingeX - 0.2, hingeY - 0.4, templeLength),
    ]);
    const leftTempleGeom = new THREE.TubeGeometry(leftTempleCurve, 24, 0.05, 8, false);
    const leftTemple = new THREE.Mesh(leftTempleGeom, frameMaterial);
    group.add(leftTemple);

    // Left ear tip (curves down behind ear)
    const leftTipCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(leftHingeX - 0.2, hingeY - 0.4, templeLength),
        new THREE.Vector3(leftHingeX - 0.22, hingeY - 0.7, templeLength + 0.2),
        new THREE.Vector3(leftHingeX - 0.2, hingeY - 1.0, templeLength + 0.3),
    ]);
    const leftTipGeom = new THREE.TubeGeometry(leftTipCurve, 12, 0.05, 8, false);
    const leftTip = new THREE.Mesh(leftTipGeom, frameMaterial);
    group.add(leftTip);

    // Right temple - mirror of left
    const rightHingeX = rightLensX + lensWidth / 2 + frameThickness;

    const rightHingeGeom = new THREE.BoxGeometry(0.15, 0.2, 0.15);
    const rightHinge = new THREE.Mesh(rightHingeGeom, metalMaterial);
    rightHinge.position.set(rightHingeX, hingeY, 0);
    group.add(rightHinge);

    const rightTempleCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(rightHingeX, hingeY, 0.05),
        new THREE.Vector3(rightHingeX + 0.1, hingeY, templeLength * 0.4),
        new THREE.Vector3(rightHingeX + 0.15, hingeY - 0.1, templeLength * 0.7),
        new THREE.Vector3(rightHingeX + 0.2, hingeY - 0.4, templeLength),
    ]);
    const rightTempleGeom = new THREE.TubeGeometry(rightTempleCurve, 24, 0.05, 8, false);
    const rightTemple = new THREE.Mesh(rightTempleGeom, frameMaterial);
    group.add(rightTemple);

    const rightTipCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(rightHingeX + 0.2, hingeY - 0.4, templeLength),
        new THREE.Vector3(rightHingeX + 0.22, hingeY - 0.7, templeLength + 0.2),
        new THREE.Vector3(rightHingeX + 0.2, hingeY - 1.0, templeLength + 0.3),
    ]);
    const rightTipGeom = new THREE.TubeGeometry(rightTipCurve, 12, 0.05, 8, false);
    const rightTip = new THREE.Mesh(rightTipGeom, frameMaterial);
    group.add(rightTip);

    // Rotate inner group 180 degrees so the front of glasses faces the camera
    // After this rotation:
    // - Lenses face the camera (correct visual)
    // - Temples go in -Z direction (away from camera, behind the face)
    // This is correct for depth-based face occlusion to work properly
    group.rotation.y = Math.PI;

    // Add inner group to outer group
    outerGroup.add(group);
    outerGroup.visible = false;

    return outerGroup;
}

// ============================================
// FACE OCCLUDER - Dynamic depth mask from landmarks
// ============================================
function createFaceOccluder() {
    // Create geometry with placeholder vertices (will be updated each frame)
    occluderGeometry = new THREE.BufferGeometry();

    // Initialize with 468 vertices (MediaPipe landmark count)
    const positions = new Float32Array(468 * 3);
    occluderGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Set triangle indices
    const indices = new Uint16Array(FACE_TRIANGLES);
    occluderGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Create invisible material - writes to depth buffer only
    const occlusionMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        side: THREE.DoubleSide
    });

    faceOccluder = new THREE.Mesh(occluderGeometry, occlusionMaterial);
    faceOccluder.renderOrder = 1;  // Render before glasses (renderOrder 2)
    faceOccluder.visible = false;
    faceOccluder.frustumCulled = false;  // Always render

    scene.add(faceOccluder);
}

function updateFaceOccluder(landmarks, videoWidth, videoHeight) {
    if (!faceOccluder || !occluderGeometry) return;

    const positions = occluderGeometry.attributes.position.array;

    // Get eye center Z as reference (same as used for glasses positioning)
    const leftEyeInner = landmarks[133];  // LANDMARKS.LEFT_EYE_INNER
    const rightEyeInner = landmarks[362]; // LANDMARKS.RIGHT_EYE_INNER
    const eyeCenterZ = (leftEyeInner.z + rightEyeInner.z) / 2;

    // Calculate glasses Z position for reference
    // Glasses lenses are at: -eyeCenterZ * videoWidth * 0.5 + 50 (approximately)
    // Temples extend BEHIND the face (lower Z values, further from camera)
    //
    // For proper occlusion:
    // - Face mesh should be BEHIND lenses (lower Z) - so lenses are always visible
    // - Face mesh should be IN FRONT OF temples (higher Z than temple tips) - to hide temples
    //
    // With corrected glasses model:
    // - Lenses are at Z ≈ glassesZ (world Z = 50)
    // - Temple tips are at Z ≈ glassesZ - templeLength*scale (much lower Z)
    //
    // We position the face occluder slightly behind the lens plane
    const glassesZ = -eyeCenterZ * videoWidth * 0.5 + 50;
    const baseZ = glassesZ - 10;  // 10 units behind lenses

    // Update vertex positions from landmarks
    for (let i = 0; i < landmarks.length && i < 468; i++) {
        const landmark = landmarks[i];

        // Convert normalized coordinates to screen space (matching glasses coordinate system)
        const x = -(landmark.x - 0.5) * videoWidth;
        const y = -(landmark.y - 0.5) * videoHeight;

        // Z: Use relative depth from eye center
        // Positive relativeZ (point is behind eye center) = point is further from camera
        // We scale the depth variations to create a realistic face shape
        const relativeZ = -(landmark.z - eyeCenterZ) * videoWidth * 0.8;
        const z = baseZ + relativeZ;

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
    }

    occluderGeometry.attributes.position.needsUpdate = true;
    occluderGeometry.computeVertexNormals();
    occluderGeometry.computeBoundingSphere();
}

// ============================================
// MEDIAPIPE FACE LANDMARKER
// ============================================
export async function initializeFaceLandmarker(onProgress) {
    try {
        onProgress?.('Loading AI model...');

        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
        );

        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: true
        });

        onProgress?.('AI model loaded');
        return true;
    } catch (error) {
        console.error('Failed to initialize Face Landmarker:', error);
        onProgress?.('Failed to load AI model');
        return false;
    }
}

// ============================================
// THREE.JS SCENE SETUP
// ============================================
export async function initializeScene(modelName, onProgress) {
    video = document.getElementById('tryon-video');
    const container = document.getElementById('threejsContainer');

    if (!video || !container) {
        throw new Error('Required DOM elements not found');
    }

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    // Setup orthographic camera for 2D overlay style
    const aspect = videoWidth / videoHeight;
    const frustumSize = videoHeight;
    camera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        2000
    );
    camera.position.z = 500;

    // Create scene
    scene = new THREE.Scene();

    // Video background
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    const videoGeometry = new THREE.PlaneGeometry(videoWidth, videoHeight);
    const videoMaterial = new THREE.MeshBasicMaterial({
        map: videoTexture,
        side: THREE.FrontSide
    });
    const videoMesh = new THREE.Mesh(videoGeometry, videoMaterial);
    videoMesh.scale.x = -1; // Mirror the video
    videoMesh.position.z = -100;
    scene.add(videoMesh);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(0, -1, 0.5);
    scene.add(fillLight);

    // Create glasses
    onProgress?.('Creating 3D glasses...');
    glassesGroup = createGlassesModel();
    glassesGroup.renderOrder = 2;  // Render after occluder
    scene.add(glassesGroup);

    // Create dynamic face occluder for realistic depth occlusion
    // This invisible mesh hides the glasses parts that should be behind the face
    createFaceOccluder();

    // Setup renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(videoWidth, videoHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Clear existing canvas
    const existingCanvas = container.querySelector('canvas');
    if (existingCanvas) {
        container.removeChild(existingCanvas);
    }
    container.appendChild(renderer.domElement);

    // Start render loop
    animate();

    onProgress?.('Ready');
    return true;
}

function animate() {
    if (!renderer || !scene || !camera) return;

    if (videoTexture) {
        videoTexture.needsUpdate = true;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

// ============================================
// FACE LANDMARK INDICES
// ============================================
const LANDMARKS = {
    // Eye corners
    LEFT_EYE_OUTER: 33,
    LEFT_EYE_INNER: 133,
    RIGHT_EYE_INNER: 362,
    RIGHT_EYE_OUTER: 263,

    // Nose
    NOSE_TIP: 1,
    NOSE_BRIDGE: 6,

    // Face bounds
    FOREHEAD: 10,
    CHIN: 152,
    LEFT_CHEEK: 234,
    RIGHT_CHEEK: 454,

    // For better rotation
    LEFT_EYE_TOP: 159,
    RIGHT_EYE_TOP: 386,
};

// ============================================
// GLASSES POSITIONING
// ============================================
function calculateGlassesTransform(landmarks, transformMatrix, videoWidth, videoHeight) {
    // Get landmarks
    const leftEyeOuter = landmarks[LANDMARKS.LEFT_EYE_OUTER];
    const leftEyeInner = landmarks[LANDMARKS.LEFT_EYE_INNER];
    const rightEyeInner = landmarks[LANDMARKS.RIGHT_EYE_INNER];
    const rightEyeOuter = landmarks[LANDMARKS.RIGHT_EYE_OUTER];

    // Calculate eye center (where glasses bridge sits)
    const eyeCenterX = (leftEyeInner.x + rightEyeInner.x) / 2;
    const eyeCenterY = (leftEyeInner.y + rightEyeInner.y) / 2;
    const eyeCenterZ = (leftEyeInner.z + rightEyeInner.z) / 2;

    // Convert normalized coords to screen space (centered at origin)
    // Video is mirrored, so we negate X
    const posX = -(eyeCenterX - 0.5) * videoWidth;
    const posY = -(eyeCenterY - 0.5) * videoHeight;
    const posZ = -eyeCenterZ * videoWidth * 0.5 + 50;

    // Calculate face width for scaling
    const faceWidth = Math.sqrt(
        Math.pow((rightEyeOuter.x - leftEyeOuter.x) * videoWidth, 2) +
        Math.pow((rightEyeOuter.y - leftEyeOuter.y) * videoHeight, 2)
    );

    // Scale glasses to fit face
    const baseGlassesWidth = 5.5;
    const targetWidth = faceWidth * 1.2;
    const scale = targetWidth / baseGlassesWidth;

    // Extract rotation from MediaPipe transformation matrix
    let rotation = new THREE.Euler(0, 0, 0, 'YXZ');

    if (transformMatrix && transformMatrix.data) {
        // MediaPipe provides a 4x4 transformation matrix in column-major order
        const m = transformMatrix.data;

        // Create Three.js Matrix4 from the data
        const matrix = new THREE.Matrix4();
        matrix.set(
            m[0], m[4], m[8], m[12],
            m[1], m[5], m[9], m[13],
            m[2], m[6], m[10], m[14],
            m[3], m[7], m[11], m[15]
        );

        // Extract rotation from matrix
        const rotationMatrix = new THREE.Matrix4();
        rotationMatrix.extractRotation(matrix);

        // Convert to Euler angles
        rotation.setFromRotationMatrix(rotationMatrix, 'YXZ');

        // Adjust for coordinate system differences and mirroring
        rotation.x = -rotation.x;
        // rotation.y stays the same
        rotation.z = -rotation.z;
    } else {
        // Fallback: calculate rotation from landmarks
        const leftCheek = landmarks[LANDMARKS.LEFT_CHEEK];
        const rightCheek = landmarks[LANDMARKS.RIGHT_CHEEK];
        const forehead = landmarks[LANDMARKS.FOREHEAD];
        const chin = landmarks[LANDMARKS.CHIN];

        // Roll (Z-axis) - head tilt sideways
        const roll = Math.atan2(
            (rightEyeOuter.y - leftEyeOuter.y),
            (rightEyeOuter.x - leftEyeOuter.x)
        );

        // Yaw (Y-axis) - head turn left/right
        const yaw = Math.asin(
            Math.max(-1, Math.min(1, (rightCheek.z - leftCheek.z) * 3))
        );

        // Pitch (X-axis) - head tilt up/down
        const pitch = Math.asin(
            Math.max(-1, Math.min(1, (chin.z - forehead.z) * 2))
        );

        rotation.set(pitch, -yaw, -roll, 'YXZ');
    }

    return {
        position: new THREE.Vector3(posX, posY, posZ),
        rotation: rotation,
        scale: new THREE.Vector3(scale, scale, scale)
    };
}

// ============================================
// TRACKING LOOP
// ============================================
export function startTracking() {
    if (isRunning) return;
    isRunning = true;
    trackFace();
}

export function stopTracking() {
    isRunning = false;
    glassesFilter.reset();
}

async function trackFace() {
    if (!isRunning || !faceLandmarker || !video) return;

    const currentTime = video.currentTime;
    if (currentTime !== lastVideoTime && video.readyState >= 2) {
        lastVideoTime = currentTime;

        try {
            const results = faceLandmarker.detectForVideo(video, performance.now());

            if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                const landmarks = results.faceLandmarks[0];

                // Get transformation matrix if available
                const transformMatrix = results.facialTransformationMatrixes &&
                    results.facialTransformationMatrixes.length > 0
                    ? results.facialTransformationMatrixes[0]
                    : null;

                const rawTransform = calculateGlassesTransform(
                    landmarks,
                    transformMatrix,
                    video.videoWidth,
                    video.videoHeight
                );

                // Apply smoothing
                const smoothed = glassesFilter.update(
                    rawTransform.position,
                    rawTransform.rotation,
                    rawTransform.scale
                );

                if (glassesGroup) {
                    glassesGroup.visible = true;
                    glassesGroup.position.copy(smoothed.position);
                    glassesGroup.rotation.copy(smoothed.rotation);
                    glassesGroup.scale.copy(smoothed.scale);
                }

                // Update face occluder mesh directly from landmarks
                if (faceOccluder) {
                    updateFaceOccluder(landmarks, video.videoWidth, video.videoHeight);
                    faceOccluder.visible = true;
                }
            } else {
                if (glassesGroup) glassesGroup.visible = false;
                if (faceOccluder) faceOccluder.visible = false;
            }
        } catch (error) {
            console.error('Tracking error:', error);
        }
    }

    requestAnimationFrame(trackFace);
}

// ============================================
// CLEANUP
// ============================================
export function cleanup() {
    isRunning = false;

    if (renderer) {
        renderer.dispose();
        renderer = null;
    }

    if (scene) {
        scene.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(m => m.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
        scene = null;
    }

    if (faceLandmarker) {
        faceLandmarker.close();
        faceLandmarker = null;
    }

    glassesFilter.reset();
    camera = null;
    glassesGroup = null;
    faceOccluder = null;
    occluderGeometry = null;
    videoTexture = null;
    video = null;
    lastVideoTime = -1;
}
