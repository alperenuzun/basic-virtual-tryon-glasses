import * as THREE from 'three';
import {MTLLoader} from 'three/examples/jsm/loaders/MTLLoader';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader';
import * as facemesh from '@tensorflow-models/facemesh';
import * as tf from '@tensorflow/tfjs-core';


var model;
var glassesObj;
var faceObj;
var triangle;
var bg;
var video;
let renderer;
let camera;
var container;
let scene;
let videoSprite;
let windowWidth = 640;
let windowHeight = 480;

function setVideoContent(){
    camera = new THREE.PerspectiveCamera(50, video.videoWidth / video.videoHeight, 1, 5000);

    camera.position.z = video.videoHeight;
    camera.position.x = -video.videoWidth / 2;
    camera.position.y = -video.videoHeight / 2;

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
    videoSprite.scale.set(-video.videoWidth, video.videoHeight, 1);
    videoSprite.position.copy(camera.position);
    videoSprite.position.z = 0;
}

function setTriangleToScene(){
    const triGeo = new THREE.Geometry();
    triGeo.vertices.push(new THREE.Vector3(1, 0, 0));
    triGeo.vertices.push(new THREE.Vector3(-1, 0, 0));
    triGeo.vertices.push(new THREE.Vector3(0, 0, 1));

    triGeo.faces.push(new THREE.Face3(0, 1, 2));

    triangle = new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    triangle.visible = false;
    scene.add(triangle);
}

function setTheLights(){
    var light = new THREE.PointLight(0xeeeeee);
    light.position.set(10, 50, 20);
    scene.add(light);
     
    var lightAmb = new THREE.AmbientLight(0xff77ff);
    scene.add(lightAmb);
}

function setGlassesToScene(objName){

    var mtlLoader = new MTLLoader();
    mtlLoader.setMaterialOptions({side:THREE.DoubleSide});
    mtlLoader.load(process.env.PUBLIC_URL+"/obj/"+objName+'.mtl', materials => {
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.load(process.env.PUBLIC_URL+"/obj/"+objName+'.obj', obj => {
            glassesObj = obj;
            glassesObj.name = objName;
            glassesObj.renderOrder = 3;
            scene.add(glassesObj);
        })
    })
}

function getFaceMask(){
    new OBJLoader().load(process.env.PUBLIC_URL+'/obj/facemesh.obj', obj => {
        obj.traverse(child => {
            if (child instanceof THREE.Mesh) {
                faceObj = new THREE.Mesh(child.geometry, new THREE.MeshLambertMaterial({side: THREE.FrontSide, color: "blue"}));
                faceObj.material.colorWrite = false;
                faceObj.renderOrder = 5;
                scene.add(faceObj);
            }
        });
    })
}

export function IntializeThreejs(objName) {
    video = document.getElementById('tryon-video');

    container = document.getElementById('threejsContainer');
    setVideoContent();

    setTheLights();

    setTriangleToScene();

    getFaceMask();
    
    setGlassesToScene(objName);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(windowWidth, windowWidth * video.videoHeight / video.videoWidth);
    
    container.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    camera.aspect = video.videoWidth / video.videoHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(windowWidth, windowWidth * video.videoHeight / video.videoWidth);
    renderer.setClearColor( 0xeeeeee, 1 );
}

function animate() {
    bg.needsUpdate = true;
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

export async function IntializeEngine() {
    await tf.setBackend('webgl');
    model = await facemesh.load({ maxFaces: 1 });
    renderPrediction();
}

async function renderPrediction() {
    
    const predictions = await model.estimateFaces(video);

    if (predictions.length > 0) {

        faceObj.visible = true;
        glassesObj.visible = true;
        for (let i = 0; i < predictions.length; i++) {
            const points = predictions[i].scaledMesh;

            const v2 = new THREE.Vector3(-points[7][0], -points[7][1], -points[7][2]);
            const v1 = new THREE.Vector3(-points[175][0], -points[175][1], -points[175][2])
            const v3 = new THREE.Vector3(-points[263][0], -points[263][1], -points[263][2])

            triangle.geometry.vertices[0].copy(v1);
            triangle.geometry.vertices[1].copy(v2);
            triangle.geometry.vertices[2].copy(v3);
            triangle.geometry.verticesNeedUpdate = true;
            triangle.geometry.computeFaceNormals();

            const p1 = new THREE.Vector3(-points[10][0], -points[10][1], -points[10][2]);
            const p2 = new THREE.Vector3(-points[175][0], -points[175][1], -points[175][2]);
            const scaleFactor = p1.distanceTo(p2) / 110.5;

            const faceBasePos = new THREE.Vector3(-points[168][0], -points[5][1], -points[10][2]-190);
            const basePosition = new THREE.Vector3(-points[168][0], -points[1][1], -points[10][2]-160);
            const lkt = triangle.geometry.faces[0].normal.clone();
            lkt.transformDirection(triangle.matrixWorld);
            lkt.add(basePosition);

            const lktFace = triangle.geometry.faces[0].normal.clone();
            lktFace.transformDirection(triangle.matrixWorld);
            lktFace.add(faceBasePos);

            faceObj.position.set(faceBasePos.x, faceBasePos.y, faceBasePos.z);
            glassesObj.position.set(basePosition.x, basePosition.y, basePosition.z);
            faceObj.lookAt(lktFace);
            glassesObj.lookAt(lkt);
            
            const diffPosX = basePosition.x - camera.position.x;
            const diffPosY = basePosition.y - camera.position.y;
            const posFactor = windowWidth*3.5 / 800;
            const rotFactor = windowWidth * 1.50;
            const posFactorY = windowHeight*4.5 / 600;
            const rotFactorY = windowHeight*1200 / 600;

            faceObj.position.x += diffPosX / posFactor;
            glassesObj.position.x += diffPosX / posFactor;
            faceObj.rotation.y += -diffPosX/ rotFactor;
            glassesObj.rotation.y += -diffPosX/ rotFactor;

            faceObj.position.y += diffPosY / posFactorY;
            glassesObj.position.y += diffPosY / posFactorY;
            faceObj.rotation.x += diffPosY/ rotFactorY;
            glassesObj.rotation.x += diffPosY/ rotFactorY;

            glassesObj.rotation.x += 0.10;

            if(Math.abs(glassesObj.rotation.y) > 0.15){
                faceObj.position.z -= 40;
                glassesObj.position.z -= 40;
            }

            glassesObj.scale.set(scaleFactor,scaleFactor,scaleFactor*1.35);
            const faceScale = scaleFactor * 1.10;
            faceObj.scale.set(faceScale,faceScale,faceScale);

            faceObj.updateWorldMatrix();
            glassesObj.updateWorldMatrix();

        }
    }
    else {
        glassesObj.visible = false;
        faceObj.visible = false;
    }
    requestAnimationFrame(renderPrediction);
}
