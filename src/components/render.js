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
let occluderMesh = null;
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

    // Load frames
    new THREE.BufferGeometryLoader().load(MODEL_PATHS.frames, (geometry) => {
        geometry.computeVertexNormals();

        // Custom material with fading at temple tips
        let vertexShader = "varying float vPosZ;\n" + THREE.ShaderLib.standard.vertexShader;
        vertexShader = vertexShader.replace('#include <fog_vertex>', 'vPosZ = position.z;');

        let fragmentShader = "uniform vec2 uBranchFading;\nvarying float vPosZ;\n" + THREE.ShaderLib.standard.fragmentShader;
        fragmentShader = fragmentShader.replace(
            '#include <fog_fragment>',
            'gl_FragColor.a = smoothstep(uBranchFading.x - uBranchFading.y*0.5, uBranchFading.x + uBranchFading.y*0.5, vPosZ);'
        );

        const frameMaterial = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                roughness: { value: 0.2 },
                metalness: { value: 0.8 },
                reflectivity: { value: 0.8 },
                envMap: { value: envMapTexture },
                envMapIntensity: { value: 1 },
                diffuse: { value: new THREE.Color(0x1a1a1a) },
                uBranchFading: { value: new THREE.Vector2(-90, 60) }
            },
            transparent: true,
            flatShading: false
        });
        frameMaterial.envMap = envMapTexture;

        const framesMesh = new THREE.Mesh(geometry, frameMaterial);
        glassesGroup.add(framesMesh);
    });

    // Load lenses
    new THREE.BufferGeometryLoader().load(MODEL_PATHS.lenses, (geometry) => {
        geometry.computeVertexNormals();

        const lensMaterial = new THREE.MeshBasicMaterial({
            envMap: envMapTexture,
            opacity: 0.6,
            color: new THREE.Color(0x442211),
            transparent: true,
            fog: false
        });

        const lensesMesh = new THREE.Mesh(geometry, lensMaterial);
        glassesGroup.add(lensesMesh);
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

                    // Create face occluder for realistic depth
                    occluderMesh = JeelizThreeHelper.create_threejsOccluder(MODEL_PATHS.occluder, (loadedOccluder) => {
                        console.log('Face occluder loaded');
                    });
                    threeStuff.faceObject.add(occluderMesh);

                    isInitialized = true;
                    onProgress?.('Ready');
                    resolve(true);
                }, undefined, (error) => {
                    console.error('Error loading env map:', error);
                    // Continue without env map
                    glassesObj = createGlasses(null);
                    threeStuff.faceObject.add(glassesObj);

                    occluderMesh = JeelizThreeHelper.create_threejsOccluder(MODEL_PATHS.occluder);
                    threeStuff.faceObject.add(occluderMesh);

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
    occluderMesh = null;
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
