# Copilot Instructions for Virtual Try-On Glasses

## Project Overview

This is a **React + Three.js + TensorFlow.js** web application for virtual glasses try-on using real-time face tracking. It captures webcam video, detects face landmarks via MediaPipe FaceMesh, and overlays 3D glasses models aligned to the user's face.

## Architecture

### Data Flow
1. **[TryOn.js](src/components/TryOn.js)** - React component that initializes webcam stream and triggers rendering
2. **[render.js](src/components/render.js)** - Core rendering engine with two main exports:
   - `IntializeThreejs(objName)` - Sets up Three.js scene, camera, lights, and loads 3D models
   - `IntializeEngine()` - Loads TensorFlow FaceMesh model and starts prediction loop

### Key Components
- **Video feed** → Hidden `<video>` element used as texture source
- **Face detection** → `@tensorflow-models/facemesh` tracks 468 facial landmarks
- **3D rendering** → Three.js scene with glasses OBJ/MTL models and invisible face mask for occlusion
- **Face alignment** → Uses landmarks #7, #175, #263 to form a triangle for orientation; #168, #10 for positioning

### 3D Assets Location
All 3D models stored in `public/obj/`:
- `*.obj` + `*.mtl` - Glasses models (e.g., `purple1.obj`)
- `facemesh.obj` - Invisible face mask for depth occlusion
- Textures referenced in MTL files

## Development Commands

```bash
npm install    # Install dependencies
npm start      # Dev server at localhost:3000
npm run build  # Production build
npm run deploy # Deploy to GitHub Pages
```

## Code Patterns

### Adding New Glasses Models
1. Place `{name}.obj` and `{name}.mtl` in `public/obj/`
2. Call `IntializeThreejs("{name}")` in [TryOn.js](src/components/TryOn.js#L28)

### Face Landmark Usage (in render.js)
- Points array: `predictions[i].scaledMesh` - 468 [x,y,z] coordinates
- Key indices: `#10` (forehead), `#168` (nose bridge), `#175` (chin), `#7/#263` (temples)
- Coordinates are negated for Three.js coordinate system

### Render Order (depth/occlusion)
- `videoSprite` - Background (default)
- `glassesObj.renderOrder = 3` - Glasses layer
- `faceObj.renderOrder = 5` + `colorWrite = false` - Invisible occluder

## Technical Constraints

- **Fixed resolution**: 640x480 video/canvas (see [TryOn.style.css](src/style/TryOn.style.css))
- **Single face**: `maxFaces: 1` in FaceMesh config
- **WebGL backend**: TensorFlow uses WebGL (`tf.setBackend('webgl')`)
- **HTTPS required**: Webcam access needs secure context in production

## Dependencies to Know

| Package | Purpose |
|---------|---------|
| `@tensorflow-models/facemesh` | Face landmark detection (468 points) |
| `three` | 3D rendering, OBJ/MTL loading |
| `react` | UI framework (class + functional components) |
