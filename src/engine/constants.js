/**
 * Landmark indices for key facial features.
 * Used to extract specific points from MediaPipe's 468-landmark face mesh.
 */
export const LM = {
    leftEyeOuter: 33,
    rightEyeOuter: 263,
    leftEyeInner: 133,
    rightEyeInner: 362,
    leftTemple: 127,
    rightTemple: 356,
    leftCheek: 234,
    rightCheek: 454,
    forehead: 10,
    chin: 175,
    noseBridge: 168,
    noseTip: 1
};

/**
 * Face oval contour — 36 landmarks tracing the face outline.
 * Used to build the dynamic face mesh occluder each frame.
 */
export const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

/**
 * Calibration parameters.
 * Adjust these to fine-tune glasses placement and scale.
 */
export const CFG = {
    refHeadWidth: 140,      // Reference head width (pixels) for scale normalization
    refFaceHeight: 210,     // Reference face height (pixels)
    glassesDepth: 10,       // Z-offset: how far glasses sit in front of the face
    glassesDown: 2,         // Y-offset: push glasses slightly downward
    glassesCenterX: 0,      // X-offset: horizontal fine-tuning
    glassesScale: 1.05      // Overall scale multiplier
};
