## Feature: Dynamic Face Mesh Occluder

**Status: Complete**

### Context

When the user turns their head, the hidden-side temple arm of the glasses should be occluded by the face — not visible over the eye or forehead. Previous approaches (static OBJ face mesh, ellipsoid, box) failed to match the actual face shape across poses. This feature uses MediaPipe's own face oval landmarks to build a per-frame occluder that tracks the face precisely.

### Approach

A **triangle fan** geometry is built from 36 face oval landmark points plus a centroid vertex:
- 36 outer vertices trace the face contour (updated every frame from landmarks)
- 1 center vertex is pushed **behind** the face along -Z to form a cone shape
- The cone provides enough depth volume to occlude temple arms at all head angles

### How It Works

1. **Geometry creation** ([engine/occluder.js](../src/engine/occluder.js)):
   - 37 vertices (index 0 = centroid, indices 1–36 = face oval)
   - 36 triangles in a fan pattern: `[0, i+1, i+2]` for each segment
   - Material: `colorWrite: false`, `depthWrite: true`, `side: DoubleSide`
   - `renderOrder: 1` (renders before glasses at `renderOrder: 3`)

2. **Per-frame update** ([engine/index.js](../src/engine/index.js)):
   - Each face oval landmark is converted to pixel coordinates
   - Each vertex is pushed forward along the face normal by `fwdOff = 8` px (covers temple hinge area)
   - Centroid is computed as the average of all oval vertices, then pushed backward along -Z by `faceWidth * 0.5` (cone depth)

### Depth Occlusion Mechanism

```
Camera → [Face Mesh (invisible, depth=1)] → [Glasses (visible, depth=3)]
                    ↓
         Writes to depth buffer only
                    ↓
         Temple arms behind face mesh → fail depth test → not drawn
         Lens/frame in front of face mesh → pass depth test → drawn
```

### Alternatives Considered

| Approach | Outcome |
|----------|---------|
| Static `facemesh.obj` | Didn't match face size/pose dynamically |
| Ellipsoid (SphereGeometry) | Too round, didn't cover temple hinge area |
| Box occluder | Angular edges visible in some poses |
| Flat disc from face oval | Insufficient depth for occlusion at angles |
| **Cone from face oval (chosen)** | Matches face precisely, cone provides depth volume |

### Key Parameters

- `fwdOff = 8` — forward push per vertex along face normal (covers temple hinge)
- `coneD = faceWidth * 0.5` — centroid pushed behind face (cone depth)
- `FACE_OVAL` — 36 landmark indices in [constants.js](../src/engine/constants.js)

### Verification

- [x] Head turn left — right temple arm hidden behind face
- [x] Head turn right — left temple arm hidden behind face
- [x] Head tilt down — temples don't appear above forehead
- [x] Lenses and frame always visible (not occluded)
- [x] No visible occluder edges (colorWrite: false)
