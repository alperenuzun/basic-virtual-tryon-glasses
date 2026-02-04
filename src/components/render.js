import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ============================================
// STATE MANAGEMENT
// ============================================
let faceLandmarker = null;
let video = null;
let renderer = null;
let camera = null;
let scene = null;
let glassesObj = null;
let faceOccluder = null;
let videoTexture = null;
let isRunning = false;
let lastVideoTime = -1;

// Canvas dimensions
const CANVAS_WIDTH = 640;

// ============================================
// SMOOTHING SYSTEM - Exponential Moving Average
// ============================================
class SmoothingFilter {
    constructor(factor = 0.3) {
        this.factor = factor; // Lower = smoother but more latency
        this.position = new THREE.Vector3();
        this.rotation = new THREE.Euler();
        this.scale = new THREE.Vector3(1, 1, 1);
        this.initialized = false;
    }

    update(newPosition, newRotation, newScale) {
        if (!this.initialized) {
            this.position.copy(newPosition);
            this.rotation.copy(newRotation);
            this.scale.copy(newScale);
            this.initialized = true;
            return;
        }

        // Exponential moving average for smooth transitions
        this.position.lerp(newPosition, this.factor);

        // Smooth rotation using spherical interpolation concept
        this.rotation.x += (newRotation.x - this.rotation.x) * this.factor;
        this.rotation.y += (newRotation.y - this.rotation.y) * this.factor;
        this.rotation.z += (newRotation.z - this.rotation.z) * this.factor;

        this.scale.lerp(newScale, this.factor);
    }

    reset() {
        this.initialized = false;
    }
}

const glassesFilter = new SmoothingFilter(0.4);  // Slightly responsive
const occluderFilter = new SmoothingFilter(0.4);

// ============================================
// MEDIAPIPE FACE LANDMARKER INITIALIZATION
// ============================================
export async function initializeFaceLandmarker(onProgress) {
    try {
        onProgress?.('Loading AI model...');

        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
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
function createVideoBackground() {
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBAFormat;

    const videoMaterial = new THREE.SpriteMaterial({
        map: videoTexture,
        depthWrite: false,
        depthTest: false
    });

    const videoSprite = new THREE.Sprite(videoMaterial);
    videoSprite.center.set(0.5, 0.5);
    videoSprite.scale.set(-video.videoWidth, video.videoHeight, 1);
    videoSprite.position.copy(camera.position);
    videoSprite.position.z = 0;
    videoSprite.renderOrder = -1;

    scene.add(videoSprite);
}

function createLighting() {
    // Main light - positioned to simulate natural lighting
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(0, 100, 100);
    scene.add(mainLight);

    // Fill light - softer, from the side
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
    fillLight.position.set(-100, 50, 50);
    scene.add(fillLight);

    // Ambient light - overall scene illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
}

function createFaceOccluder() {
    return new Promise((resolve) => {
        const loader = new OBJLoader();
        loader.load(
            process.env.PUBLIC_URL + '/obj/facemesh.obj',
            (obj) => {
                obj.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        faceOccluder = new THREE.Mesh(
                            child.geometry,
                            new THREE.MeshBasicMaterial({
                                colorWrite: false,
                                side: THREE.DoubleSide
                            })
                        );
                        faceOccluder.renderOrder = 1;
                        faceOccluder.visible = false;
                        scene.add(faceOccluder);
                    }
                });
                resolve();
            },
            undefined,
            (error) => {
                console.warn('Face occluder not loaded:', error);
                resolve();
            }
        );
    });
}

function loadGlassesModel(modelName, onProgress) {
    return new Promise((resolve, reject) => {
        onProgress?.('Loading 3D glasses model...');

        const mtlLoader = new MTLLoader();
        mtlLoader.setMaterialOptions({ side: THREE.DoubleSide });

        mtlLoader.load(
            process.env.PUBLIC_URL + '/obj/' + modelName + '.mtl',
            (materials) => {
                materials.preload();

                const objLoader = new OBJLoader();
                objLoader.setMaterials(materials);

                objLoader.load(
                    process.env.PUBLIC_URL + '/obj/' + modelName + '.obj',
                    (obj) => {
                        glassesObj = obj;
                        glassesObj.name = modelName;
                        glassesObj.renderOrder = 2;
                        glassesObj.visible = false;

                        // Optimize materials
                        glassesObj.traverse((child) => {
                            if (child instanceof THREE.Mesh) {
                                if (child.material) {
                                    child.material.needsUpdate = true;
                                }
                            }
                        });

                        scene.add(glassesObj);
                        onProgress?.('3D model loaded');
                        resolve();
                    },
                    undefined,
                    reject
                );
            },
            undefined,
            reject
        );
    });
}

// ============================================
// MAIN INITIALIZATION
// ============================================
export async function initializeScene(modelName, onProgress) {
    video = document.getElementById('tryon-video');
    const container = document.getElementById('threejsContainer');

    if (!video || !container) {
        throw new Error('Required DOM elements not found');
    }

    // Setup camera
    const aspectRatio = video.videoWidth / video.videoHeight;
    camera = new THREE.PerspectiveCamera(50, aspectRatio, 1, 5000);
    camera.position.set(-video.videoWidth / 2, -video.videoHeight / 2, video.videoHeight);

    // Create scene
    scene = new THREE.Scene();

    // Setup renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit for performance
    renderer.setSize(CANVAS_WIDTH, CANVAS_WIDTH * video.videoHeight / video.videoWidth);
    renderer.sortObjects = true;

    // Clear existing canvas if any
    const existingCanvas = container.querySelector('canvas');
    if (existingCanvas) {
        container.removeChild(existingCanvas);
    }
    container.appendChild(renderer.domElement);

    // Build scene
    createVideoBackground();
    createLighting();

    // Load models in parallel
    await Promise.all([
        createFaceOccluder(),
        loadGlassesModel(modelName, onProgress)
    ]);

    // Start render loop
    animate();

    // Handle window resize
    window.addEventListener('resize', handleResize);

    return true;
}

function handleResize() {
    if (!camera || !renderer || !video) return;

    camera.aspect = video.videoWidth / video.videoHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(CANVAS_WIDTH, CANVAS_WIDTH * video.videoHeight / video.videoWidth);
}

// ============================================
// RENDER LOOP
// ============================================
function animate() {
    if (!renderer || !scene || !camera) return;

    if (videoTexture) {
        videoTexture.needsUpdate = true;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

// ============================================
// FACE TRACKING & GLASSES POSITIONING
// ============================================

// Key MediaPipe Face Landmark indices for glasses positioning
const LANDMARKS = {
    // Eye corners for width calculation
    LEFT_EYE_OUTER: 33,
    LEFT_EYE_INNER: 133,
    RIGHT_EYE_INNER: 362,
    RIGHT_EYE_OUTER: 263,

    // Nose bridge for center positioning
    NOSE_BRIDGE_TOP: 6,
    NOSE_BRIDGE_MID: 168,

    // Forehead and chin for face orientation
    FOREHEAD: 10,
    CHIN: 152,

    // Cheekbones for face width
    LEFT_CHEEK: 234,
    RIGHT_CHEEK: 454,

    // For rotation calculation
    LEFT_EAR: 234,
    RIGHT_EAR: 454
};

function calculateGlassesTransform(landmarks, videoWidth, videoHeight) {
    // Get key landmark positions
    const leftEyeOuter = landmarks[LANDMARKS.LEFT_EYE_OUTER];
    const rightEyeOuter = landmarks[LANDMARKS.RIGHT_EYE_OUTER];
    const leftEyeInner = landmarks[LANDMARKS.LEFT_EYE_INNER];
    const rightEyeInner = landmarks[LANDMARKS.RIGHT_EYE_INNER];
    const noseBridge = landmarks[LANDMARKS.NOSE_BRIDGE_TOP];
    const forehead = landmarks[LANDMARKS.FOREHEAD];
    const chin = landmarks[LANDMARKS.CHIN];
    const leftCheek = landmarks[LANDMARKS.LEFT_CHEEK];
    const rightCheek = landmarks[LANDMARKS.RIGHT_CHEEK];

    // Calculate center position between eyes (glasses bridge position)
    const centerX = (leftEyeInner.x + rightEyeInner.x) / 2;
    const centerZ = (leftEyeInner.z + rightEyeInner.z) / 2;

    // Convert to Three.js coordinate system
    const posX = -(centerX * videoWidth);
    const posY = -(noseBridge.y * videoHeight) + 15; // Slight offset up for bridge
    const posZ = -(centerZ * videoWidth) - 170; // Depth adjustment

    // Calculate scale based on face width (distance between eye corners)
    const eyeDistance = Math.sqrt(
        Math.pow((rightEyeOuter.x - leftEyeOuter.x) * videoWidth, 2) +
        Math.pow((rightEyeOuter.y - leftEyeOuter.y) * videoHeight, 2) +
        Math.pow((rightEyeOuter.z - leftEyeOuter.z) * videoWidth, 2)
    );

    // Calculate scale factor (calibrated for the glasses model)
    const scaleFactor = eyeDistance / 115; // Adjusted divisor for proper fit

    // Calculate rotation angles

    // Yaw (Y-axis rotation) - head turning left/right
    const yaw = Math.atan2(
        rightCheek.z - leftCheek.z,
        rightCheek.x - leftCheek.x
    );

    // Pitch (X-axis rotation) - head tilting up/down
    const pitch = Math.atan2(
        forehead.z - chin.z,
        forehead.y - chin.y
    ) - Math.PI / 2;

    // Roll (Z-axis rotation) - head tilting sideways
    const roll = Math.atan2(
        rightEyeOuter.y - leftEyeOuter.y,
        rightEyeOuter.x - leftEyeOuter.x
    );

    return {
        position: new THREE.Vector3(posX, posY, posZ),
        rotation: new THREE.Euler(
            -pitch * 0.8,           // Pitch with dampening
            yaw - Math.PI / 2,      // Yaw adjustment
            roll,                    // Roll
            'YXZ'                   // Rotation order
        ),
        scale: new THREE.Vector3(
            scaleFactor,
            scaleFactor,
            scaleFactor * 1.2       // Slightly more depth
        )
    };
}

function applyTransformWithSmoothing(object, transform, filter) {
    if (!object) return;

    filter.update(transform.position, transform.rotation, transform.scale);

    object.position.copy(filter.position);
    object.rotation.copy(filter.rotation);
    object.scale.copy(filter.scale);
}

export function startTracking() {
    if (isRunning) return;
    isRunning = true;
    trackFace();
}

export function stopTracking() {
    isRunning = false;
    glassesFilter.reset();
    occluderFilter.reset();
}

async function trackFace() {
    if (!isRunning || !faceLandmarker || !video) return;

    // Only process if we have a new video frame
    const currentTime = video.currentTime;
    if (currentTime !== lastVideoTime && video.readyState >= 2) {
        lastVideoTime = currentTime;

        try {
            const results = faceLandmarker.detectForVideo(video, performance.now());

            if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                const landmarks = results.faceLandmarks[0];

                // Calculate glasses transform
                const transform = calculateGlassesTransform(
                    landmarks,
                    video.videoWidth,
                    video.videoHeight
                );

                // Apply with smoothing
                if (glassesObj) {
                    glassesObj.visible = true;
                    applyTransformWithSmoothing(glassesObj, transform, glassesFilter);
                }

                // Apply to face occluder with slight offset
                if (faceOccluder) {
                    faceOccluder.visible = true;
                    const occluderTransform = {
                        position: transform.position.clone().add(new THREE.Vector3(0, -10, 30)),
                        rotation: transform.rotation.clone(),
                        scale: transform.scale.clone().multiplyScalar(1.05)
                    };
                    applyTransformWithSmoothing(faceOccluder, occluderTransform, occluderFilter);
                }
            } else {
                // No face detected - hide objects
                if (glassesObj) glassesObj.visible = false;
                if (faceOccluder) faceOccluder.visible = false;
            }
        } catch (error) {
            console.error('Face tracking error:', error);
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

    window.removeEventListener('resize', handleResize);

    glassesFilter.reset();
    occluderFilter.reset();

    camera = null;
    glassesObj = null;
    faceOccluder = null;
    videoTexture = null;
    video = null;
    lastVideoTime = -1;
}
