import type { MatrixKind } from "./types.js";
import { BLUE_NOISE_64 } from "./bluenoise-data.js";

const B2: number[][] = [
  [0, 2],
  [3, 1],
];

/** Side length of the matrix: 2, 4, 8, or 64. */
export function matrixSize(kind: MatrixKind): number {
  switch (kind) {
    case "bayer2":
      return 2;
    case "bayer4":
      return 4;
    case "bayer8":
      return 8;
    case "blueNoise":
      return 64;
  }
}

const cache = new Map<MatrixKind, Uint16Array>();

/** Build Bayer matrix of side 2n from Bn via standard recursion. */
function bayerFrom(Bn: Uint16Array, n: number): Uint16Array {
  const side = 2 * n;
  const out = new Uint16Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const base = Bn[(y % n) * n + (x % n)]!;
      const q = B2[(y / n) | 0]![(x / n) | 0]!;
      out[y * side + x] = 4 * base + q;
    }
  }
  return out;
}

function buildBayer2(): Uint16Array {
  return new Uint16Array([0, 2, 3, 1]);
}

function buildMatrix(kind: MatrixKind): Uint16Array {
  switch (kind) {
    case "bayer2":
      return buildBayer2();
    case "bayer4":
      return bayerFrom(buildBayer2(), 2);
    case "bayer8":
      return bayerFrom(bayerFrom(buildBayer2(), 2), 4);
    case "blueNoise":
      return BLUE_NOISE_64;
  }
}

/** The raw rank matrix, row-major. Values are a permutation of 0..n*n-1. */
export function rankMatrix(kind: MatrixKind): Uint16Array {
  let m = cache.get(kind);
  if (!m) {
    m = buildMatrix(kind);
    cache.set(kind, m);
  }
  return m;
}

/** Normalized threshold, strictly between 0 and 1, tiling with period matrixSize(kind). */
export function thresholdAt(kind: MatrixKind, x: number, y: number): number {
  const n = matrixSize(kind);
  const m = rankMatrix(kind);
  const ix = ((x % n) + n) % n;
  const iy = ((y % n) + n) % n;
  const rank = m[iy * n + ix]!;
  return (rank + 0.5) / (n * n);
}
