/**
 * Ulichney void-and-cluster blue-noise generator for a 64×64 rank matrix.
 * Writes src/bluenoise-data.ts. No dependencies. Fully deterministic.
 *
 * Usage: node scripts/gen-bluenoise.mjs
 *
 * Energy is maintained incrementally (add/remove a Gaussian impulse at a
 * flipped cell). Equivalent to full-field recompute each step.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const N = 64;
const N2 = N * N; // 4096
const HALF = N2 / 2; // 2048
const SIGMA = 1.5;
const INITIAL_ONES = 410; // ~10%
const SEED = 0xdecafbad;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gaussian kernel on the torus, min-image offsets in [-N/2, N/2).
 * Weight exp(-r²/σ²) with σ=1.5 — the form used by classic V&C dither-array
 * code (equivalent to a normal with std σ/√2 under the 2σ² convention).
 */
function buildKernel(sigma) {
  const weights = [];
  const inv = 1 / (sigma * sigma);
  const half = N / 2;
  for (let dy = -half; dy < half; dy++) {
    for (let dx = -half; dx < half; dx++) {
      const w = Math.exp(-(dx * dx + dy * dy) * inv);
      if (w > 1e-20) weights.push({ dx, dy, w });
    }
  }
  return weights;
}

const KERNEL = buildKernel(SIGMA);

function splat(energy, at, sign) {
  const cx = at % N;
  const cy = (at / N) | 0;
  for (const { dx, dy, w } of KERNEL) {
    const x = (cx + dx + N) % N;
    const y = (cy + dy + N) % N;
    energy[y * N + x] += sign * w;
  }
}

function energyFromPattern(pattern) {
  const energy = new Float64Array(N2);
  for (let i = 0; i < N2; i++) {
    if (pattern[i]) splat(energy, i, +1);
  }
  return energy;
}

/**
 * Extreme cell among ones or zeros. On exact energy ties, break with a
 * deterministic scramble key so raster-order bias cannot lattice-lock voids.
 */
function extremeCell(pattern, energy, wantOne, wantMax, scramble) {
  let best = -1;
  let bestE = wantMax ? -Infinity : Infinity;
  let bestKey = 0;
  for (let i = 0; i < N2; i++) {
    if (!!pattern[i] !== wantOne) continue;
    const e = energy[i];
    const key = scramble[i];
    if (wantMax) {
      if (e > bestE || (e === bestE && key > bestKey)) {
        bestE = e;
        bestKey = key;
        best = i;
      }
    } else if (e < bestE || (e === bestE && key < bestKey)) {
      bestE = e;
      bestKey = key;
      best = i;
    }
  }
  return best;
}

function tightestCluster(pattern, energy, scramble) {
  return extremeCell(pattern, energy, true, true, scramble);
}

function largestVoid(pattern, energy, scramble) {
  return extremeCell(pattern, energy, false, false, scramble);
}

function generate() {
  const rand = mulberry32(SEED);
  const scramble = new Float64Array(N2);
  for (let i = 0; i < N2; i++) scramble[i] = rand();

  // --- Seed ~10% ones at unique pseudo-random positions ---
  const pattern = new Uint8Array(N2);
  const used = new Set();
  while (used.size < INITIAL_ONES) {
    const i = (rand() * N2) | 0;
    if (!used.has(i)) {
      used.add(i);
      pattern[i] = 1;
    }
  }

  let energy = energyFromPattern(pattern);

  // --- Phase 1: homogenize ---
  // Remove tightest cluster, insert at largest void. Stop when the void
  // chosen is the cell just removed.
  for (;;) {
    const c = tightestCluster(pattern, energy, scramble);
    pattern[c] = 0;
    splat(energy, c, -1);
    const v = largestVoid(pattern, energy, scramble);
    if (v === c) {
      pattern[c] = 1;
      splat(energy, c, +1);
      break;
    }
    pattern[v] = 1;
    splat(energy, v, +1);
  }

  const prototype = new Uint8Array(pattern);
  let M = 0;
  for (let i = 0; i < N2; i++) if (prototype[i]) M++;

  const ranks = new Int32Array(N2);
  ranks.fill(-1);

  // --- Phase 2: ranks M-1 down to 0 ---
  const work = new Uint8Array(prototype);
  energy = energyFromPattern(work);
  for (let rank = M - 1; rank >= 0; rank--) {
    const c = tightestCluster(work, energy, scramble);
    ranks[c] = rank;
    work[c] = 0;
    splat(energy, c, -1);
  }

  // --- Phase 3: ranks M up to 2047 ---
  work.set(prototype);
  energy = energyFromPattern(work);
  for (let rank = M; rank < HALF; rank++) {
    const v = largestVoid(work, energy, scramble);
    ranks[v] = rank;
    work[v] = 1;
    splat(energy, v, +1);
  }

  // --- Phase 4: ranks 2048 up to 4095 ---
  // Tightest cluster of zeros = max energy among ones of the inverted pattern.
  const inv = new Uint8Array(N2);
  for (let i = 0; i < N2; i++) inv[i] = work[i] ? 0 : 1;
  let invEnergy = energyFromPattern(inv);

  for (let rank = HALF; rank < N2; rank++) {
    const c = tightestCluster(inv, invEnergy, scramble);
    ranks[c] = rank;
    work[c] = 1;
    inv[c] = 0;
    splat(invEnergy, c, -1);
  }

  // Sanity: permutation of 0..N2-1
  const seen = new Uint8Array(N2);
  for (let i = 0; i < N2; i++) {
    const r = ranks[i];
    if (r < 0 || r >= N2 || seen[r]) {
      throw new Error(`Invalid rank at ${i}: ${r}`);
    }
    seen[r] = 1;
  }

  return { ranks, M };
}

const t0 = Date.now();
const { ranks, M } = generate();
const ms = Date.now() - t0;

function meanNN(k) {
  const cells = [];
  for (let i = 0; i < N2; i++) if (ranks[i] < k) cells.push([i % N, (i / N) | 0]);
  let sum = 0;
  for (let i = 0; i < cells.length; i++) {
    let best = Infinity;
    const ax = cells[i][0];
    const ay = cells[i][1];
    for (let j = 0; j < cells.length; j++) {
      if (i === j) continue;
      const bx = cells[j][0];
      const by = cells[j][1];
      let dx = Math.abs(ax - bx);
      let dy = Math.abs(ay - by);
      if (dx > N / 2) dx = N - dx;
      if (dy > N / 2) dy = N - dy;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / cells.length;
}

const nn256 = meanNN(256);
const nn1024 = meanNN(1024);
console.log(`M=${M} ${ms}ms  meanNN256=${nn256.toFixed(4)}  meanNN1024=${nn1024.toFixed(4)}`);

const values = Array.from(ranks).join(", ");
const out = `// GENERATED FILE - do not edit by hand. Regenerate with \`node scripts/gen-bluenoise.mjs\`.
export const BLUE_NOISE_64 = new Uint16Array([ ${values} ]);
`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "src", "bluenoise-data.ts");
writeFileSync(outPath, out, "utf8");
console.log(`Wrote ${outPath} (${N2} values)`);

if (!(nn256 > 3.0) || !(nn1024 > 1.5)) {
  console.error("Spectral quality below acceptance thresholds.");
  process.exit(1);
}
