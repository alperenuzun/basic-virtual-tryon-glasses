import * as THREE from 'three';

const CANVAS_WIDTH = 640;

/** Create an orthographic camera sized to the video dimensions. */
export function createCamera(video) {
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    var cam = new THREE.OrthographicCamera(
        -vw / 2, vw / 2,
        vh / 2, -vh / 2,
        0.1, 5000
    );
    cam.position.set(-vw / 2, -vh / 2, 500);
    return cam;
}

/** Create the video background sprite and its texture. */
export function createVideoBackground(video, camera) {
    var vw = video.videoWidth;
    var vh = video.videoHeight;

    var bg = new THREE.Texture(video);
    bg.minFilter = THREE.LinearFilter;

    var sprite = new THREE.Sprite(new THREE.MeshBasicMaterial({
        map: bg,
        depthWrite: false,
        side: THREE.DoubleSide
    }));
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(-vw, vh, 1);
    sprite.position.copy(camera.position);
    sprite.position.z = 0;

    return { bg, sprite };
}

/** Create the scene lighting (key, fill, rim, ambient). */
export function createLights() {
    var key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(0, 100, 200);

    var fill = new THREE.DirectionalLight(0xeeeeff, 0.45);
    fill.position.set(-80, 30, 100);

    var rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(60, 60, -80);

    var amb = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);

    return [key, fill, rim, amb];
}

/** Create the WebGL renderer with production-quality settings. */
export function createRenderer(video) {
    var r = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
    });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(CANVAS_WIDTH, CANVAS_WIDTH * video.videoHeight / video.videoWidth);
    r.physicallyCorrectLights = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.outputEncoding = THREE.sRGBEncoding;
    return r;
}

/** Handle window resize for the orthographic camera. */
export function handleResize(camera, renderer, video) {
    var vw = video.videoWidth, vh = video.videoHeight;
    camera.left = -vw / 2;
    camera.right = vw / 2;
    camera.top = vh / 2;
    camera.bottom = -vh / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(CANVAS_WIDTH, CANVAS_WIDTH * vh / vw);
}
