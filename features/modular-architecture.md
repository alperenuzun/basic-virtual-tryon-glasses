## Feature: Modular Engine Architecture

**Status: Complete**

### Context

The entire rendering engine lived in a single `render.js` file (528 lines). This made it hard to read, maintain, or contribute to. For open-source sharing, the codebase needed a clean separation of concerns.

### What Changed

**Before:** One monolithic file (`src/components/render.js`) containing constants, utilities, 3D model creation, scene setup, face tracking, and the prediction loop — all interleaved.

**After:** Six focused modules under `src/engine/`:

```
src/engine/
├── index.js        # Orchestrator — state, init, prediction loop (public API)
├── constants.js    # LM landmarks, FACE_OVAL contour, CFG calibration
├── helpers.js      # Pure math utilities (clamp, toV, mid, eyeMid, qDelta, toPixels)
├── glasses.js      # Procedural sunglasses model (geometry + materials)
├── occluder.js     # Dynamic face mesh occluder (triangle fan)
└── scene.js        # Camera, renderer, lights, video background, resize handler
```

### Design Principles

- **Single responsibility** — each module owns one concern
- **Stateless factories** — `glasses.js`, `occluder.js`, `scene.js`, `helpers.js` have no module-level state; all state lives in `index.js`
- **Pure utilities** — `helpers.js` functions take all inputs as parameters (e.g. `toPixels(landmarks, video)` instead of referencing a module-level `video`)
- **Backward-compatible exports** — `index.js` exports both new names (`initializeThreejs`) and legacy aliases (`IntializeThreejs`) for smooth migration

### Module Dependency Graph

```
TryOn.js
  └── engine/index.js
        ├── engine/constants.js   (LM, FACE_OVAL, CFG)
        ├── engine/helpers.js     (math utilities)
        ├── engine/glasses.js     (createSunglasses)
        ├── engine/occluder.js    (createDynamicFaceMesh)
        └── engine/scene.js       (createCamera, createVideoBackground, ...)
```

No circular dependencies. All sub-modules are imported only by `index.js`.

### Public API

```javascript
import { initializeThreejs, initializeEngine } from './engine';

// Set up Three.js scene with video background and 3D models
initializeThreejs(objName);

// Load MediaPipe FaceLandmarker and start the prediction loop
await initializeEngine();
```

### Verification

- [x] `npm run build` compiles without errors
- [x] All functionality preserved (tracking, occlusion, smoothing, capture)
- [x] No circular dependencies
- [x] Old `render.js` removed from imports
