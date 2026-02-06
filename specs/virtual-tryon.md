## Spec: Stabilized 3D Glasses Fit

### Goal
Deliver a real-time virtual try-on that looks stable, aligned to head pose, and sized correctly to the face, with minimal jitter and a convincing fit around temples and ears.

### Non-Goals (for this iteration)
- Multi-face support
- Per-model calibration UI
- Advanced occlusion using depth sensors

### Functional Requirements
- Glasses remain centered on the face using facial landmarks.
- Glasses scale to head width and face height for consistent size.
- Glasses orientation aligns to head pose (yaw, pitch, roll).
- Jitter reduced via smoothing without noticeable lag.
- Occluder (face mask) remains aligned to prevent clipping artifacts.

### Acceptance Criteria
- On steady face, glasses show no visible jitter at normal webcam resolution.
- On moderate head turns, glasses stay aligned with eye line and nose bridge.
- On approach or distance changes, glasses scale smoothly without size jumps.
- Occluder tracks the face with matching orientation.

### Tracking Strategy
- Key landmarks: outer eye corners, temples, cheeks, nose bridge, forehead, chin.
- Orientation: compute basis from eye line (x-axis) and face normal (z-axis).
- Position: eye midpoint with tuned offsets for natural placement.
- Scale: weighted combination of head width and face height.

### Stabilization Strategy
- Exponential smoothing for position, rotation, and scale.
- Adaptive alpha based on frame-to-frame movement.

### Tunable Parameters (render.js)
- `MODEL_METRICS.headWidth`
- `MODEL_METRICS.faceHeight`
- `MODEL_METRICS.glassesDepth`
- `MODEL_METRICS.glassesDown`
- `MODEL_METRICS.faceDepth`
- Smoothing alpha ranges in `renderPrediction`

### Test Plan
- Test with steady face, slow head turns, and rapid movement.
- Check alignment at different distances to camera.
- Confirm occlusion covers cheeks/bridge without clipping lenses.
