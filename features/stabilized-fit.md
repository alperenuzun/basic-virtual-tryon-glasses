## Feature: Stabilized Face Fit

**Status: Complete**

### Context

The original alignment used a small set of points with direct transforms, causing jitter, incorrect sizing, and poor edge-of-frame behavior. This feature replaced that with a full landmark-based orientation system, orthographic camera, weighted scaling, and adaptive smoothing.

### What Changed

| Before | After |
|--------|-------|
| PerspectiveCamera (edge distortion) | OrthographicCamera (no distortion at edges) |
| MediaPipe transformation matrix (reverse rotation bug) | Landmark-based rotation matrix (eye-line, forehead-chin, cross-product) |
| Fixed smoothing alpha | Adaptive alpha based on movement magnitude |
| 3-point triangle orientation | 10+ landmark multi-axis orientation |
| External OBJ glasses model | Procedural wayfarer sunglasses (code-only) |

### Implementation Details

**Orientation computation** ([engine/index.js](../src/engine/index.js)):
- X-axis: right eye → left eye (normalized)
- Y-raw: forehead → chin (normalized)
- Z-axis: cross(X, Y-raw), negated if facing away from camera
- Y-axis: cross(Z, X) for orthogonal basis
- Z-flip quaternion applied (model faces +Z, scene uses -Z)

**Scale computation:**
- `baseScale = 0.7 * (faceWidth / refHeadWidth) + 0.3 * (faceHeight / refFaceHeight)`
- `finalScale = baseScale * glassesScale`

**Adaptive smoothing:**
- Position: `alpha = clamp(0.12 + movement * 0.012, 0.12, 0.50)`
- Rotation: `alpha = clamp(0.12 + angleDelta * 0.4, 0.12, 0.55)`
- Scale: `alpha = clamp(0.14 + movement * 0.008, 0.14, 0.40)`

### Decisions Made

- **OrthographicCamera over PerspectiveCamera** — eliminates all perspective distortion, glasses don't appear rotated at canvas edges
- **Landmark-based rotation over transformation matrix** — MediaPipe's transformation matrix had coordinate system issues causing reverse rotation; direct landmark computation is more reliable
- **70/30 width/height blend** — width alone caused size jumps when face rotates; adding height component stabilizes scaling
- **Z-flip quaternion** — simpler and more predictable than negating quaternion components

### Tuning Reference

All parameters in [src/engine/constants.js](../src/engine/constants.js) — `CFG` object. Key values:
- `glassesDepth: 10` — Z-offset from eye midpoint
- `glassesDown: 2` — Y-offset to sit on nose bridge
- `glassesScale: 1.05` — overall multiplier

### Verification

- [x] Steady face — no visible jitter
- [x] Head turns — alignment maintained in all directions
- [x] Rapid movement — smooth tracking without lag
- [x] Canvas edges — no distortion
- [x] Distance changes — proportional scaling
