// Bayer 8×8 ordered-dither matrix (spec §5.2). Row-major, raw values 0..63.
// Normalize to (v + 0.5) / 64 for the shader uniform so threshold compares
// directly against luminance (0..1).
export const BAYER8 = [
  0, 48, 12, 60,  3, 51, 15, 63,  32, 16, 44, 28, 35, 19, 47, 31,
  8, 56,  4, 52, 11, 59,  7, 55,  40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62,  1, 49, 13, 61,  34, 18, 46, 30, 33, 17, 45, 29,
 10, 58,  6, 54,  9, 57,  5, 53,  42, 26, 38, 22, 41, 25, 37, 21,
];

export const BAYER8_NORM: number[] = BAYER8.map((v) => (v + 0.5) / 64);
