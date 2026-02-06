## Feature: Stabilized Face Fit v1

### Context
Current alignment uses a small set of points and direct transforms, which causes jitter and poor sizing. This feature replaces that with a landmark basis, improved scaling, and adaptive smoothing.

### Implementation Notes
- Use eye line (outer corners) for lateral orientation.
- Use face normal for forward direction and roll stability.
- Apply offsets along local axes to match natural glasses placement.
- Smooth position, rotation, and scale with adaptive alpha.

### Decisions
- Scale = 75% head width + 25% face height.
- Smoothing increases with movement to reduce lag on fast motion.
- Occluder uses the same transform as glasses for consistent depth.

### Tuning Checklist
- Adjust `MODEL_METRICS.headWidth` to match model size.
- Adjust `glassesDepth` to sit correctly on the nose bridge.
- Adjust `glassesDown` to align frames with the eye line.

### Next Steps
- Add per-model calibration profile.
- Optional: implement Kalman filter for extra stability.
