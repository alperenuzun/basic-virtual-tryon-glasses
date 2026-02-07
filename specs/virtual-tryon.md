## Spec: Virtual Try-On Glasses — Real-Time AR Experience

### Goal

Deliver a browser-based virtual try-on that renders procedural 3D sunglasses on the user's face in real time, with stable tracking, correct occlusion, and a polished UI suitable for sharing on social platforms.

### Non-Goals (for this iteration)

- Multi-face support
- Per-model calibration UI
- Depth-sensor-based occlusion
- Multiple glasses selection at runtime

### Functional Requirements

| # | Requirement | Status |
|---|-------------|--------|
| FR-1 | Glasses remain centered on the face using MediaPipe 468-point landmarks | Done |
| FR-2 | Glasses scale proportionally to head width (70%) and face height (30%) | Done |
| FR-3 | Glasses orientation aligns to head pose (yaw, pitch, roll) via landmark-based rotation matrix | Done |
| FR-4 | Jitter reduced via adaptive exponential smoothing (lerp/slerp) without noticeable lag | Done |
| FR-5 | Dynamic face mesh occluder hides temple arms behind the head when turning | Done |
| FR-6 | Procedural sunglasses model (no external OBJ/GLTF dependency for glasses geometry) | Done |
| FR-7 | Screenshot capture (PNG download) | Done |
| FR-8 | Video recording (WebM download via MediaRecorder) | Done |
| FR-9 | Responsive layout that works on desktop and mobile browsers | Done |

### Acceptance Criteria

- [x] On steady face, glasses show no visible jitter at normal webcam resolution.
- [x] On moderate head turns (left/right/up/down), glasses stay aligned with eye line and nose bridge.
- [x] On approach or distance changes, glasses scale smoothly without size jumps.
- [x] When head turns, hidden-side temple arm is occluded by the face mesh (not visible over the eye).
- [x] Glasses render correctly at canvas edges without perspective distortion.
- [x] Screenshot produces a downloadable PNG snapshot.
- [x] Video recording produces a downloadable WebM file.
- [x] UI is centered, dark-themed, and responsive on mobile viewports.

### Architecture

```
Webcam → <video> → MediaPipe FaceLandmarker → 468 landmarks
                                                    ↓
                              Landmark processing (helpers.js)
                                                    ↓
                    ┌───────────────────────────────────────────────┐
                    │              engine/index.js                  │
                    │  Position · Rotation · Scale · Smoothing      │
                    └────────┬──────────────┬──────────────┬────────┘
                             ↓              ↓              ↓
                      glasses.js      occluder.js      scene.js
                    (sunglasses)   (face mesh mask)  (camera/lights)
                             ↓              ↓              ↓
                    ┌───────────────────────────────────────────────┐
                    │           Three.js WebGL Renderer             │
                    │  OrthographicCamera · Depth-based occlusion   │
                    └───────────────────────────────────────────────┘
```

### Tracking Strategy

- **Landmarks used:** outer/inner eye corners, temples, cheeks, nose bridge, nose tip, forehead, chin (defined in `LM` — [constants.js](../src/engine/constants.js))
- **Orientation:** Rotation matrix from eye-line (X-axis), forehead-chin (Y-axis), cross-product face normal (Z-axis), with Z-flip for model alignment
- **Position:** Eye midpoint with configurable offsets along local axes (`glassesDepth`, `glassesDown`, `glassesCenterX`)
- **Scale:** Weighted blend — `70% × headWidth + 30% × faceHeight`, normalized against reference values, then multiplied by `glassesScale`

### Stabilization Strategy

- Adaptive exponential smoothing for position, rotation (slerp), and scale
- Alpha values increase with movement magnitude to reduce lag on fast motion
- Position alpha: 0.12–0.50, Rotation alpha: 0.12–0.55, Scale alpha: 0.14–0.40

### Occlusion Strategy

- 36-vertex face oval contour from MediaPipe (`FACE_OVAL` in [constants.js](../src/engine/constants.js))
- Triangle fan geometry with centroid pushed behind the face along -Z (cone shape, depth = `faceWidth × 0.5`)
- Each vertex pushed forward along face normal by 8px per frame
- Material: `colorWrite: false`, `depthWrite: true`, `renderOrder: 1` (renders before glasses at `renderOrder: 3`)

### Tunable Parameters

All in `CFG` object — [src/engine/constants.js](../src/engine/constants.js):

| Parameter | Value | Description |
|-----------|-------|-------------|
| `refHeadWidth` | 140 | Reference head width (px) for scale normalization |
| `refFaceHeight` | 210 | Reference face height (px) for scale normalization |
| `glassesScale` | 1.05 | Overall scale multiplier |
| `glassesDepth` | 10 | Z-offset from eye midpoint toward camera |
| `glassesDown` | 2 | Y-offset to sit on nose bridge |
| `glassesCenterX` | 0 | X-offset for horizontal centering |

### Render Order

| Order | Object | colorWrite | depthWrite | Purpose |
|:-----:|--------|:----------:|:----------:|---------|
| 0 | Video sprite | Yes | No | Background |
| 1 | Face mesh occluder | No | Yes | Invisible depth barrier |
| 3 | Sunglasses | Yes | Yes | Visible glasses (depth-tested against occluder) |

### Test Plan

- [x] Steady face — no visible jitter
- [x] Slow head turns — alignment maintained
- [x] Rapid movement — smoothing prevents jumps
- [x] Canvas edges — no perspective distortion (orthographic camera)
- [x] Head turn left/right — temple occlusion works
- [x] Distance changes — scale adjusts smoothly
- [x] Screenshot button — PNG downloaded
- [x] Record button — WebM recorded and downloaded
- [x] Mobile viewport — responsive layout renders correctly
- [x] `npm run build` — compiles without errors
