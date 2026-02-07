import * as THREE from 'three';

/** Clamp value between lo and hi. */
export function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

/** Convert landmark pixel coords to negated Three.js Vector3. */
export function toV(pts, i) {
    return new THREE.Vector3(-pts[i][0], -pts[i][1], -pts[i][2]);
}

/** Midpoint of two Vector3s. */
export function mid(a, b) {
    return a.clone().add(b).multiplyScalar(0.5);
}

/** Midpoint between inner and outer eye landmarks. */
export function eyeMid(pts, inner, outer) {
    return mid(toV(pts, inner), toV(pts, outer));
}

/** Angular delta between two quaternions (radians). */
export function qDelta(a, b) {
    return 2 * Math.acos(clamp(Math.abs(a.dot(b)), 0, 1));
}

/** Convert normalized MediaPipe landmarks to pixel coordinates. */
export function toPixels(landmarks, video) {
    var w = video.videoWidth, h = video.videoHeight;
    return landmarks.map(function(l) {
        return [l.x * w, l.y * h, l.z * w];
    });
}

/** Create a rounded rectangle Shape (for extrusion). */
export function rrShape(w, h, r, oy) {
    oy = oy || 0;
    var s = new THREE.Shape();
    var x0 = -w / 2, x1 = w / 2;
    var y0 = -h / 2 + oy, y1 = h / 2 + oy;
    r = Math.min(r, w / 2, h / 2);
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r);
    s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
}

/** Create a rounded rectangle Path (for hole cutouts). */
export function rrPath(w, h, r, oy) {
    oy = oy || 0;
    var p = new THREE.Path();
    var x0 = -w / 2, x1 = w / 2;
    var y0 = -h / 2 + oy, y1 = h / 2 + oy;
    r = Math.min(r, w / 2, h / 2);
    p.moveTo(x0 + r, y0);
    p.lineTo(x1 - r, y0);
    p.quadraticCurveTo(x1, y0, x1, y0 + r);
    p.lineTo(x1, y1 - r);
    p.quadraticCurveTo(x1, y1, x1 - r, y1);
    p.lineTo(x0 + r, y1);
    p.quadraticCurveTo(x0, y1, x0, y1 - r);
    p.lineTo(x0, y0 + r);
    p.quadraticCurveTo(x0, y0, x0 + r, y0);
    return p;
}
