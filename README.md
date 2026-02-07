# Virtual Try-On Glasses

Real-time AR glasses try-on experience powered by MediaPipe face tracking and Three.js 3D rendering. Try on sunglasses directly in your browser using your webcam.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Demo

**[Live Demo](https://alperenuzun.github.io/basic-virtual-tryon-glasses)**

## Features

- **Real-time face tracking** — MediaPipe FaceLandmarker with 468 facial landmarks
- **3D glasses overlay** — Procedural sunglasses model rendered with Three.js
- **Face mesh occlusion** — Dynamic occluder hides temple arms behind the head realistically
- **Adaptive smoothing** — Exponential smoothing on position, rotation, and scale for stable tracking
- **Screenshot capture** — Download a PNG snapshot of the try-on
- **Video recording** — Record and download a WebM video of your session
- **Responsive UI** — Works on desktop and mobile browsers

## Getting Started

### Prerequisites

- Node.js >= 18
- A browser with WebGL and webcam support
- HTTPS (required for webcam access in production)

### Installation

```bash
git clone https://github.com/alperenuzun/basic-virtual-tryon-glasses.git
cd basic-virtual-tryon-glasses
npm install
```

### Development

```bash
npm start
```

Opens the app at [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build
```

### Deploy to GitHub Pages

```bash
npm run deploy
```

## Project Structure

```
src/
├── components/
│   ├── App.js              # Root React component
│   └── TryOn.js            # Webcam setup, UI controls, screenshot & recording
├── engine/
│   ├── index.js             # Main orchestrator — scene init, prediction loop
│   ├── constants.js         # Landmark indices, face oval, calibration config
│   ├── helpers.js           # Math utilities (clamp, lerp helpers, coordinate conversion)
│   ├── glasses.js           # Procedural sunglasses model (geometry + materials)
│   ├── occluder.js          # Dynamic face mesh occluder (depth-only rendering)
│   └── scene.js             # Camera, renderer, lights, video background
└── style/
    ├── index.style.css      # Global styles
    └── TryOn.style.css      # Try-on page layout, controls, responsive design
```

## How It Works

1. **Webcam capture** — `TryOn.js` requests camera access and pipes the stream to a hidden `<video>` element.

2. **Scene setup** — `engine/index.js` creates an orthographic Three.js scene with the video feed as a background sprite, adds the procedural glasses model and face occluder.

3. **Face tracking** — MediaPipe FaceLandmarker runs on each video frame, producing 468 3D facial landmarks.

4. **Glasses placement** — Key landmarks (eyes, nose bridge, temples, forehead, chin) are used to compute:
   - **Position** — midpoint between eyes, offset along face normal
   - **Orientation** — rotation matrix from eye-line (X), forehead-chin (Y), and face normal (Z)
   - **Scale** — proportional to measured face width and height

5. **Occlusion** — A 36-vertex face oval mesh (invisible, depth-write only) prevents temple arms from rendering in front of the face when the head turns.

6. **Smoothing** — Adaptive exponential smoothing (lerp for position/scale, slerp for rotation) eliminates jitter while keeping tracking responsive.

## Customization

### Adjusting Glasses Appearance

Edit [src/engine/glasses.js](src/engine/glasses.js) to change:
- Lens size, shape, and color
- Frame thickness and material
- Temple length and splay angle
- Bridge width

### Tuning Tracking Parameters

Edit the `CFG` object in [src/engine/constants.js](src/engine/constants.js):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `refHeadWidth` | 140 | Reference head width for scale normalization |
| `refFaceHeight` | 210 | Reference face height for scale normalization |
| `glassesScale` | 1.05 | Overall glasses scale multiplier |
| `glassesDepth` | 10 | Z-offset from eye midpoint (closer to face = lower) |
| `glassesDown` | 2 | Y-offset to sit on nose bridge |
| `glassesCenterX` | 0 | X-offset for horizontal centering |

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [React](https://reactjs.org/) | UI framework |
| [Three.js](https://threejs.org/) | 3D rendering (WebGL) |
| [MediaPipe FaceLandmarker](https://developers.google.com/mediapipe/solutions/vision/face_landmarker) | Real-time face tracking |

## License

MIT
