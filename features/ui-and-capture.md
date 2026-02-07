## Feature: Modern UI and Media Capture

**Status: Complete**

### Context

The try-on experience needed a polished, shareable interface suitable for social media (LinkedIn, etc.). The original UI was minimal with no capture capabilities. This feature adds a dark-themed layout, screenshot/video capture, and responsive mobile support.

### UI Design

- **Dark theme** — `#09090f` background, subtle borders with `rgba(255,255,255,0.06)`
- **Centered viewport** — 16px border-radius, ambient box-shadow
- **Gradient title** — linear-gradient from white to muted purple
- **Glassmorphism buttons** — semi-transparent background with hover/active transitions
- **Loading state** — spinner overlay while camera initializes

### Screenshot Capture

**Implementation** ([TryOn.js](../src/components/TryOn.js)):
```
canvas.toDataURL('image/png') → <a> download click → PNG file
```
- Reads directly from the Three.js canvas using `preserveDrawingBuffer: true`
- Downloads as `virtual-tryon-{timestamp}.png`

### Video Recording

**Implementation** ([TryOn.js](../src/components/TryOn.js)):
```
canvas.captureStream(30fps) → MediaRecorder → Blob → WebM file
```
- Uses `canvas.captureStream(30)` for 30fps recording
- Prefers VP9 codec when available, falls back to default WebM
- Record button pulses red with animation during recording
- Downloads as `virtual-tryon-{timestamp}.webm` on stop

### Responsive Layout

- **Desktop** — centered viewport with rounded corners and shadow
- **Mobile (<700px)** — full-width viewport, no border-radius, buttons stretch to fill

### Files Changed

| File | Changes |
|------|---------|
| [TryOn.js](../src/components/TryOn.js) | Added loading state, screenshot handler, video recording handler |
| [TryOn.style.css](../src/style/TryOn.style.css) | Complete redesign — dark theme, centered layout, controls, responsive |
| [index.style.css](../src/style/index.style.css) | Dark background, font smoothing |
| [index.html](../../public/index.html) | Inter font, updated title |

### Verification

- [x] Loading spinner shown while camera initializes
- [x] Screenshot button downloads PNG
- [x] Record button starts/stops recording with visual feedback
- [x] Recording downloads WebM on stop
- [x] Responsive layout works on mobile viewport
- [x] Dark theme renders correctly
