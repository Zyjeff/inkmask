import { describe, it, expect } from "vitest";
import { matrixSize, rankMatrix, thresholdAt } from "../src/matrix.js";
import { BLUE_NOISE_64 } from "../src/bluenoise-data.js";
import type { MatrixKind } from "../src/types.js";

const KINDS: MatrixKind[] = ["bayer2", "bayer4", "bayer8", "blueNoise"];

function isPermutation(arr: ArrayLike<number>, n2: number): boolean {
  if (arr.length !== n2) return false;
  const seen = new Uint8Array(n2);
  let max = -1;
  for (let i = 0; i < n2; i++) {
    const v = arr[i] as number;
    if (v < 0 || v >= n2 || seen[v]) return false;
    seen[v] = 1;
    if (v > max) max = v;
  }
  return max === n2 - 1;
}

/**
 * Mean toroidal nearest-neighbour distance among the k lowest-ranked cells.
 * Uniform random at this density averages ~2.0 (k=256) / ~1.0 (k=1024);
 * ideal hexagonal packing ~4.3 / ~2.15. Blue noise should sit well above random.
 */
function meanNearestNeighbour(ranks: ArrayLike<number>, n: number, k: number): number {
  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < ranks.length; i++) {
    if ((ranks[i] as number) < k) {
      cells.push({ x: i % n, y: (i / n) | 0 });
    }
  }
  expect(cells.length).toBe(k);

  let sum = 0;
  for (let i = 0; i < cells.length; i++) {
    let best = Infinity;
    const a = cells[i]!;
    for (let j = 0; j < cells.length; j++) {
      if (i === j) continue;
      const b = cells[j]!;
      let dx = Math.abs(a.x - b.x);
      let dy = Math.abs(a.y - b.y);
      if (dx > n / 2) dx = n - dx;
      if (dy > n / 2) dy = n - dy;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / cells.length;
}

describe("matrixSize", () => {
  it("returns 2, 4, 8, 64 for the four kinds", () => {
    expect(matrixSize("bayer2")).toBe(2);
    expect(matrixSize("bayer4")).toBe(4);
    expect(matrixSize("bayer8")).toBe(8);
    expect(matrixSize("blueNoise")).toBe(64);
  });
});

describe("rankMatrix", () => {
  it('rankMatrix("bayer2") is exactly [0,2,3,1]', () => {
    expect(Array.from(rankMatrix("bayer2"))).toEqual([0, 2, 3, 1]);
  });

  it.each(["bayer2", "bayer4", "bayer8"] as const)(
    "%s rank matrix is a permutation of 0..n*n-1",
    (kind) => {
      const n = matrixSize(kind);
      const m = rankMatrix(kind);
      expect(isPermutation(m, n * n)).toBe(true);
    },
  );
});

describe("thresholdAt", () => {
  it("is strictly between 0 and 1 over one full tile for every kind", () => {
    for (const kind of KINDS) {
      const n = matrixSize(kind);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const t = thresholdAt(kind, x, y);
          expect(t).toBeGreaterThan(0);
          expect(t).toBeLessThan(1);
        }
      }
    }
  });

  it("tiles with period n, including negative coordinates", () => {
    const samples: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [3, 5],
      [-1, 0],
      [0, -1],
      [-3, -7],
      [100, -50],
    ];
    for (const kind of KINDS) {
      const n = matrixSize(kind);
      for (const [x, y] of samples) {
        expect(thresholdAt(kind, x, y)).toBe(thresholdAt(kind, x + n, y + n));
        expect(thresholdAt(kind, x, y)).toBe(thresholdAt(kind, x - n, y - n));
        expect(thresholdAt(kind, x, y)).toBe(thresholdAt(kind, x + 2 * n, y));
      }
    }
  });
});

describe("BLUE_NOISE_64", () => {
  it("has length 4096 and is a permutation of 0..4095", () => {
    expect(BLUE_NOISE_64.length).toBe(4096);
    expect(isPermutation(BLUE_NOISE_64, 4096)).toBe(true);
  });

  it("spectral check: 256 lowest ranks mean NN distance > 3.0", () => {
    // random ≈ 2.0, ideal hex ≈ 4.3 — 3.0 separates blue from white noise
    const mean = meanNearestNeighbour(BLUE_NOISE_64, 64, 256);
    // eslint-disable-next-line no-console
    console.log(`blueNoise 256-point mean NN distance: ${mean}`);
    expect(mean).toBeGreaterThan(3.0);
  });

  it("spectral check: 1024 lowest ranks mean NN distance > 1.5", () => {
    // random ≈ 1.0, ideal hex ≈ 2.15
    const mean = meanNearestNeighbour(BLUE_NOISE_64, 64, 1024);
    // eslint-disable-next-line no-console
    console.log(`blueNoise 1024-point mean NN distance: ${mean}`);
    expect(mean).toBeGreaterThan(1.5);
  });
});
