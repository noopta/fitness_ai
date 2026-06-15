// SkSL runtime shader — ordered Bayer 8×8 dither into a 2-color duotone
// (spec §5.3). Snaps each pixel to a coarse "cell" so the stipple reads
// chunky; samples luminance from the source image at the cell center;
// applies a contrast push and (for photos) a vignette; thresholds against
// the per-cell Bayer value; outputs one of two inks.
export const DITHER_SKSL = `
uniform shader image;       // cover-fit source (photo or gradient)
uniform float2 res;         // canvas size in px (DPR-scaled)
uniform float  cell;        // grain cell size in px (animated 7×→1× on mount)
uniform float3 darkInk;     // 0..1, swap with lightInk in Light scheme
uniform float3 lightInk;    // 0..1
uniform float  vignette;    // 1 for photos, 0 for procedural gradient
uniform float  bayer[64];   // normalized 0..1

half4 main(float2 fc) {
    // Snap to the coarse cell center → chunky stipple
    float2 cellCoord = floor(fc / cell) * cell + cell * 0.5;
    half4  src = image.eval(cellCoord);

    float L = dot(src.rgb, half3(0.299, 0.587, 0.114));
    L = clamp((L - 0.5) * 1.32 + 0.52, 0.0, 1.0);

    if (vignette > 0.5) {
        float2 uv = cellCoord / res - 0.5;
        L *= 1.06 - dot(uv, uv) * 1.15;
        L -= (cellCoord.y / res.y) * 0.06;
        L  = clamp(L, 0.0, 1.0);
    }

    int   bx = int(mod(floor(fc.x / cell), 8.0));
    int   by = int(mod(floor(fc.y / cell), 8.0));
    float th = bayer[by * 8 + bx];

    float3 ink = (L > th) ? lightInk : darkInk;
    return half4(ink, 1.0);
}
`;
