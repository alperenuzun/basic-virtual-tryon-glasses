/**
 * Virtual Try-On Glasses - Jeeliz FaceFilter Implementation
 * Clean implementation with proper face occlusion
 */

import * as THREE from 'three';
import { JEELIZFACEFILTER, NN_DEFAULT } from 'facefilter';
import JeelizThreeHelper from '../helpers/JeelizThreeHelper';

// ============================================
// STATE
// ============================================
let threeCamera = null;
let glassesObj = null;
let isInitialized = false;

// ============================================
// MODEL PATHS (relative to public folder)
// ============================================
const MODEL_PATHS = {
    envMap: process.env.PUBLIC_URL + '/models/envMap.jpg',
    frames: process.env.PUBLIC_URL + '/models/glassesFrames.json',
    lenses: process.env.PUBLIC_URL + '/models/glassesLenses.json',
    occluder: process.env.PUBLIC_URL + '/models/face.json'
};

// ============================================
// CREATE GLASSES
// ============================================
function createGlasses(envMapTexture) {
    const glassesGroup = new THREE.Object3D();

    // Load frames with simple material (avoid complex shader issues)
    new THREE.BufferGeometryLoader().load(MODEL_PATHS.frames, (geometry) => {
        geometry.computeVertexNormals();

        // Use MeshStandardMaterial for reliable rendering
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.3,
            metalness: 0.8,
            envMap: envMapTexture,
            envMapIntensity: 1.0
        });

        const framesMesh = new THREE.Mesh(geometry, frameMaterial);
        glassesGroup.add(framesMesh);
    }, undefined, (error) => {
        console.error('Error loading frames:', error);
    });

    // Load lenses
    new THREE.BufferGeometryLoader().load(MODEL_PATHS.lenses, (geometry) => {
        geometry.computeVertexNormals();

        const lensMaterial = new THREE.MeshBasicMaterial({
            color: 0x442211,
            envMap: envMapTexture,
            opacity: 0.6,
            transparent: true,
            reflectivity: 0.8
        });

        const lensesMesh = new THREE.Mesh(geometry, lensMaterial);
        glassesGroup.add(lensesMesh);
    }, undefined, (error) => {
        console.error('Error loading lenses:', error);
    });

    return glassesGroup;
}

// ============================================
// INITIALIZE
// ============================================
export async function initialize(canvasId, onProgress) {
    return new Promise((resolve, reject) => {
        onProgress?.('Initializing face detection...');

        JEELIZFACEFILTER.init({
            canvasId: canvasId,
            NNC: NN_DEFAULT,  // Neural network data (not path)
            maxFacesDetected: 1,
            followZRot: true,

            callbackReady: (errCode, spec) => {
                if (errCode) {
                    console.error('Jeeliz init error:', errCode);
                    onProgress?.('Failed to initialize');
                    reject(new Error('Face detection initialization failed: ' + errCode));
                    return;
                }

                onProgress?.('Setting up 3D scene...');

                // Initialize Three.js with Jeeliz helper
                const threeStuff = JeelizThreeHelper.init(spec, (faceIndex, isDetected) => {
                    // Detection callback
                    if (isDetected) {
                        console.log('Face detected');
                    } else {
                        console.log('Face lost');
                    }
                });

                // Create camera
                threeCamera = JeelizThreeHelper.create_camera();

                // Add ambient light
                const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
                threeStuff.scene.add(ambientLight);

                // Add directional light
                const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
                dirLight.position.set(0, 0.5, 1);
                threeStuff.scene.add(dirLight);

                // Load environment map texture
                onProgress?.('Loading 3D models...');
                const textureLoader = new THREE.TextureLoader();
                textureLoader.load(MODEL_PATHS.envMap, (envMapTexture) => {
                    envMapTexture.mapping = THREE.EquirectangularReflectionMapping;
                    envMapTexture.magFilter = THREE.LinearFilter;
                    envMapTexture.minFilter = THREE.LinearMipMapLinearFilter;

                    // Create glasses
                    glassesObj = createGlasses(envMapTexture);
                    threeStuff.faceObject.add(glassesObj);

                    // Note: Face occluder disabled for now due to geometry format issues
                    // TODO: Fix occluder JSON format for Three.js r160 compatibility

                    isInitialized = true;
                    onProgress?.('Ready');
                    resolve(true);
                }, undefined, (error) => {
                    console.error('Error loading env map:', error);
                    // Continue without env map
                    glassesObj = createGlasses(null);
                    threeStuff.faceObject.add(glassesObj);

                    isInitialized = true;
                    onProgress?.('Ready');
                    resolve(true);
                });
            },

            callbackTrack: (detectState) => {
                // Render loop - called every frame
                JeelizThreeHelper.render(detectState, threeCamera);
            }
        });
    });
}

// ============================================
// CLEANUP
// ============================================
export function cleanup() {
    if (isInitialized) {
        JEELIZFACEFILTER.destroy();
        isInitialized = false;
    }
    threeCamera = null;
    glassesObj = null;
}

// ============================================
// RESIZE HANDLER
// ============================================
export function resize() {
    if (isInitialized && threeCamera) {
        JEELIZFACEFILTER.resize();
        JeelizThreeHelper.update_camera(threeCamera);
    }
}
