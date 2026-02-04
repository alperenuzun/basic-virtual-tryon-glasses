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
let videoTexture = null;
let isRunning = false;
let lastVideoTime = -1;

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
// 3D GLASSES MODEL - Programmatic Creation
// ============================================
function createGlassesModel() {
    const group = new THREE.Group();

    // Materials
    const frameMaterial = new THREE.MeshPhongMaterial({
        color: 0x1a1a1a,
        shininess: 100,
        specular: 0x444444,
    });

    const lensMaterial = new THREE.MeshPhongMaterial({
        color: 0x2a1a0a,
        transparent: true,
        opacity: 0.7,
        shininess: 150,
        specular: 0x333333,
        side: THREE.DoubleSide,
    });

    const metalMaterial = new THREE.MeshPhongMaterial({
        color: 0xcccccc,
        shininess: 200,
        specular: 0xffffff,
    });

    // Dimensions (in scene units, calibrated for face)
    const lensWidth = 2.4;
    const lensHeight = 1.8;
    const lensDepth = 0.15;
    const bridgeWidth = 0.8;
    const frameThickness = 0.12;
    const templeLength = 4.5;

    // === LEFT LENS ===
    const leftLensGeom = new THREE.BoxGeometry(lensWidth, lensHeight, lensDepth);
    // Round the corners using edge beveling
    const leftLens = new THREE.Mesh(leftLensGeom, lensMaterial);
    leftLens.position.set(-1.5, 0, 0);
    group.add(leftLens);

    // Left lens frame (border)
    const leftFrameShape = new THREE.Shape();
    const fw = lensWidth / 2 + frameThickness;
    const fh = lensHeight / 2 + frameThickness;
    leftFrameShape.moveTo(-fw, -fh);
    leftFrameShape.lineTo(fw, -fh);
    leftFrameShape.lineTo(fw, fh);
    leftFrameShape.lineTo(-fw, fh);
    leftFrameShape.lineTo(-fw, -fh);

    // Hole for lens
    const leftHole = new THREE.Path();
    const hw = lensWidth / 2;
    const hh = lensHeight / 2;
    leftHole.moveTo(-hw, -hh);
    leftHole.lineTo(hw, -hh);
    leftHole.lineTo(hw, hh);
    leftHole.lineTo(-hw, hh);
    leftHole.lineTo(-hw, -hh);
    leftFrameShape.holes.push(leftHole);

    const leftFrameGeom = new THREE.ExtrudeGeometry(leftFrameShape, {
        depth: lensDepth + 0.05,
        bevelEnabled: false
    });
    const leftFrame = new THREE.Mesh(leftFrameGeom, frameMaterial);
    leftFrame.position.set(-1.5, 0, -lensDepth / 2 - 0.025);
    group.add(leftFrame);

    // === RIGHT LENS ===
    const rightLensGeom = new THREE.BoxGeometry(lensWidth, lensHeight, lensDepth);
    const rightLens = new THREE.Mesh(rightLensGeom, lensMaterial);
    rightLens.position.set(1.5, 0, 0);
    group.add(rightLens);

    // Right lens frame
    const rightFrameShape = new THREE.Shape();
    rightFrameShape.moveTo(-fw, -fh);
    rightFrameShape.lineTo(fw, -fh);
    rightFrameShape.lineTo(fw, fh);
    rightFrameShape.lineTo(-fw, fh);
    rightFrameShape.lineTo(-fw, -fh);

    const rightHole = new THREE.Path();
    rightHole.moveTo(-hw, -hh);
    rightHole.lineTo(hw, -hh);
    rightHole.lineTo(hw, hh);
    rightHole.lineTo(-hw, hh);
    rightHole.lineTo(-hw, -hh);
    rightFrameShape.holes.push(rightHole);

    const rightFrameGeom = new THREE.ExtrudeGeometry(rightFrameShape, {
        depth: lensDepth + 0.05,
        bevelEnabled: false
    });
    const rightFrame = new THREE.Mesh(rightFrameGeom, frameMaterial);
    rightFrame.position.set(1.5, 0, -lensDepth / 2 - 0.025);
    group.add(rightFrame);

    // === NOSE BRIDGE ===
    const bridgeGeom = new THREE.BoxGeometry(bridgeWidth, frameThickness * 2, lensDepth);
    const bridge = new THREE.Mesh(bridgeGeom, frameMaterial);
    bridge.position.set(0, 0.2, 0);
    group.add(bridge);

    // === NOSE PADS ===
    const nosePadGeom = new THREE.SphereGeometry(0.12, 8, 8);
    const leftNosePad = new THREE.Mesh(nosePadGeom, metalMaterial);
    leftNosePad.position.set(-0.35, -0.4, 0.15);
    leftNosePad.scale.set(1, 1.5, 0.5);
    group.add(leftNosePad);

    const rightNosePad = new THREE.Mesh(nosePadGeom, metalMaterial);
    rightNosePad.position.set(0.35, -0.4, 0.15);
    rightNosePad.scale.set(1, 1.5, 0.5);
    group.add(rightNosePad);

    // === TEMPLES (Arms) ===
    // Left temple
    const leftTempleGeom = new THREE.BoxGeometry(templeLength, frameThickness, frameThickness);
    const leftTemple = new THREE.Mesh(leftTempleGeom, frameMaterial);
    leftTemple.position.set(-1.5 - lensWidth / 2 - templeLength / 2, lensHeight / 2 - frameThickness, -0.2);
    group.add(leftTemple);

    // Left temple hinge
    const leftHingeGeom = new THREE.BoxGeometry(0.2, frameThickness * 2, frameThickness * 2);
    const leftHinge = new THREE.Mesh(leftHingeGeom, metalMaterial);
    leftHinge.position.set(-1.5 - lensWidth / 2 - 0.1, lensHeight / 2 - frameThickness, -0.1);
    group.add(leftHinge);

    // Right temple
    const rightTempleGeom = new THREE.BoxGeometry(templeLength, frameThickness, frameThickness);
    const rightTemple = new THREE.Mesh(rightTempleGeom, frameMaterial);
    rightTemple.position.set(1.5 + lensWidth / 2 + templeLength / 2, lensHeight / 2 - frameThickness, -0.2);
    group.add(rightTemple);

    // Right temple hinge
    const rightHingeGeom = new THREE.BoxGeometry(0.2, frameThickness * 2, frameThickness * 2);
    const rightHinge = new THREE.Mesh(rightHingeGeom, metalMaterial);
    rightHinge.position.set(1.5 + lensWidth / 2 + 0.1, lensHeight / 2 - frameThickness, -0.1);
    group.add(rightHinge);

    // Temple tips (ear hooks)
    const tipCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-0.1, -0.2, 0.1),
        new THREE.Vector3(-0.15, -0.5, 0.15),
    ]);
    const tipGeom = new THREE.TubeGeometry(tipCurve, 8, frameThickness / 2, 6, false);

    const leftTip = new THREE.Mesh(tipGeom, frameMaterial);
    leftTip.position.set(-1.5 - lensWidth / 2 - templeLength, lensHeight / 2 - frameThickness, -0.2);
    group.add(leftTip);

    const rightTip = new THREE.Mesh(tipGeom, frameMaterial);
    rightTip.position.set(1.5 + lensWidth / 2 + templeLength, lensHeight / 2 - frameThickness, -0.2);
    rightTip.scale.x = -1;
    group.add(rightTip);

    group.visible = false;
    return group;
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
    scene.add(glassesGroup);

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
function calculateGlassesTransform(landmarks, videoWidth, videoHeight) {
    // Get landmarks
    const leftEyeOuter = landmarks[LANDMARKS.LEFT_EYE_OUTER];
    const leftEyeInner = landmarks[LANDMARKS.LEFT_EYE_INNER];
    const rightEyeInner = landmarks[LANDMARKS.RIGHT_EYE_INNER];
    const rightEyeOuter = landmarks[LANDMARKS.RIGHT_EYE_OUTER];
    const forehead = landmarks[LANDMARKS.FOREHEAD];
    const chin = landmarks[LANDMARKS.CHIN];
    const leftCheek = landmarks[LANDMARKS.LEFT_CHEEK];
    const rightCheek = landmarks[LANDMARKS.RIGHT_CHEEK];

    // Calculate eye center (where glasses bridge sits)
    const eyeCenterX = (leftEyeInner.x + rightEyeInner.x) / 2;
    const eyeCenterY = (leftEyeInner.y + rightEyeInner.y) / 2;
    const eyeCenterZ = (leftEyeInner.z + rightEyeInner.z) / 2;

    // Convert normalized coords to screen space (centered at origin)
    // Note: Video is mirrored, so we negate X
    const posX = -(eyeCenterX - 0.5) * videoWidth;
    const posY = -(eyeCenterY - 0.5) * videoHeight;
    const posZ = -eyeCenterZ * videoWidth * 0.5 + 50; // Bring forward

    // Calculate face width for scaling
    const faceWidth = Math.sqrt(
        Math.pow((rightEyeOuter.x - leftEyeOuter.x) * videoWidth, 2) +
        Math.pow((rightEyeOuter.y - leftEyeOuter.y) * videoHeight, 2)
    );

    // Scale glasses to fit face (base glasses width is ~6 units)
    const baseGlassesWidth = 6;
    const targetWidth = faceWidth * 1.15; // Slightly wider than eye distance
    const scale = targetWidth / baseGlassesWidth;

    // Calculate rotations
    // Roll (Z-axis) - head tilt
    const roll = Math.atan2(
        (rightEyeOuter.y - leftEyeOuter.y) * videoHeight,
        (rightEyeOuter.x - leftEyeOuter.x) * videoWidth
    );

    // Yaw (Y-axis) - head turn left/right
    const yaw = Math.asin(
        Math.max(-1, Math.min(1, (rightCheek.z - leftCheek.z) * 2))
    );

    // Pitch (X-axis) - head tilt up/down
    const faceVertical = (forehead.y - chin.y) * videoHeight;
    const faceDepth = (forehead.z - chin.z) * videoWidth;
    const pitch = Math.atan2(faceDepth, faceVertical);

    return {
        position: new THREE.Vector3(posX, posY, posZ),
        rotation: new THREE.Euler(-pitch * 0.5, yaw, -roll, 'YXZ'),
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

                const rawTransform = calculateGlassesTransform(
                    landmarks,
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
            } else {
                if (glassesGroup) glassesGroup.visible = false;
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
    videoTexture = null;
    video = null;
    lastVideoTime = -1;
}
