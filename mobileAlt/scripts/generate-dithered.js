// Offline pre-render of the onboarding dither (replaces the live Skia shader).
// Bakes dither/dither.sksl.ts EXACTLY into static 2-colour PNGs so each scene
// mounts a cheap <Image> instead of a Skia <Canvas> + RuntimeEffect.
//
//   node scripts/generate-dithered.js
//
// Shader parity notes:
//  - cellCoord = floor(fc/cell)*cell + cell/2  (sample at cell centre)
//  - L = clamp((luma-0.5)*1.32 + 0.52, 0, 1)
//  - vignette (photos): L *= 1.06 - dot(uv,uv)*1.15; L -= (y/H)*0.06
//  - threshold against Bayer-8 per cell; output lightInk if L>th else darkInk
//  Each cell is a single solid ink (L + Bayer index are constant within a cell),
//  so we compute one ink per cell and block-fill.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BAYER8 = [
  0, 48, 12, 60,  3, 51, 15, 63,  32, 16, 44, 28, 35, 19, 47, 31,
  8, 56,  4, 52, 11, 59,  7, 55,  40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62,  1, 49, 13, 61,  34, 18, 46, 30, 33, 17, 45, 29,
 10, 58,  6, 54,  9, 57,  5, 53,  42, 26, 38, 22, 41, 25, 37, 21,
];
const BAYER = BAYER8.map((v) => (v + 0.5) / 64);

const INKS = {
  Ember: { dark: [22, 7, 6],   light: [240, 205, 194] },
  Steel: { dark: [7, 13, 19],  light: [201, 223, 240] },
  Ash:   { dark: [11, 11, 13], light: [230, 230, 234] },
};

// scene photo -> wash (all scheme Dark, vignette on). Each photo is used once.
const PHOTOS_DIR = path.join(__dirname, '..', 'src', 'onboarding', 'assets', 'photos');
const OUT_DIR = path.join(__dirname, '..', 'src', 'onboarding', 'assets', 'dithered');
const JOBS = [
  { file: 'gym-oldschool.png', wash: 'Ember' },
  { file: 'nutrition.png',     wash: 'Ember' },
  { file: 'coach-squat.png',   wash: 'Steel' },
  { file: 'hype-duo.png',      wash: 'Ash'   },
  { file: 'equip-gymleco.png', wash: 'Steel' },
  { file: 'physique-back.png', wash: 'Ember' },
  { file: 'rack-smith.png',    wash: 'Ember' },
];

// Canonical portrait render (iPhone XR aspect @3x). cell = 1.25pt * 3 ≈ 3.26px so
// cells-across ≈ 331, matching the on-device live dither. Displayed resizeMode
// "cover", so small per-device aspect differences just re-crop a little.
const W = 1080;
const H = 2337;            // 1080 * (1792/828)
const CELLS_X = 331;
const CELL = W / CELLS_X;  // ≈3.263 px

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function coverMapper(sw, sh) {
  const scale = Math.max(W / sw, H / sh);
  const dispW = sw * scale, dispH = sh * scale;
  const offX = (W - dispW) / 2, offY = (H - dispH) / 2;
  return (cx, cy) => {
    const sx = clamp(Math.round((cx - offX) / scale), 0, sw - 1);
    const sy = clamp(Math.round((cy - offY) / scale), 0, sh - 1);
    return (sy * sw + sx) * 4;
  };
}

function generate({ file, wash }) {
  const src = PNG.sync.read(fs.readFileSync(path.join(PHOTOS_DIR, file)));
  const { dark, light } = INKS[wash];
  const map = coverMapper(src.width, src.height);
  const cellsY = Math.ceil(H / CELL);

  // One ink per cell (constant L + Bayer index within a cell).
  const grid = new Uint8Array(CELLS_X * cellsY); // 1 = light, 0 = dark
  for (let cy = 0; cy < cellsY; cy++) {
    const by = cy % 8;
    for (let cx = 0; cx < CELLS_X; cx++) {
      const ccx = cx * CELL + CELL / 2;
      const ccy = cy * CELL + CELL / 2;
      const i = map(ccx, ccy);
      let L = (0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2]) / 255;
      L = clamp((L - 0.5) * 1.32 + 0.52, 0, 1);
      // vignette (all scenes are photos -> on)
      const ux = ccx / W - 0.5, uy = ccy / H - 0.5;
      L *= 1.06 - (ux * ux + uy * uy) * 1.15;
      L -= (ccy / H) * 0.06;
      L = clamp(L, 0, 1);
      const th = BAYER[by * 8 + (cx % 8)];
      grid[cy * CELLS_X + cx] = L > th ? 1 : 0;
    }
  }

  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    const cy = Math.floor(y / CELL);
    for (let x = 0; x < W; x++) {
      const cx = Math.floor(x / CELL);
      const ink = grid[cy * CELLS_X + cx] ? light : dark;
      const o = (y * W + x) * 4;
      out.data[o] = ink[0];
      out.data[o + 1] = ink[1];
      out.data[o + 2] = ink[2];
      out.data[o + 3] = 255;
    }
  }
  const outPath = path.join(OUT_DIR, file);
  fs.writeFileSync(outPath, PNG.sync.write(out, { colorType: 2 })); // RGB, no alpha
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`  ${file.padEnd(20)} ${wash.padEnd(6)} ${kb} KB`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`Rendering ${W}x${H}, ${CELLS_X} cells across (cell ${CELL.toFixed(2)}px):`);
for (const job of JOBS) generate(job);
console.log('Done ->', path.relative(process.cwd(), OUT_DIR));
