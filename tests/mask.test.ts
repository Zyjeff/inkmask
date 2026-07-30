import { describe, it, expect } from "vitest";
import {
  computeCoverage,
  resolveMaskToCells,
  thresholdCoverage,
  thresholdCoverageByCell,
} from "../src/mask.js";
import { thresholdAt } from "../src/matrix.js";
import { relativeLuminance } from "../src/color.js";
import type { MaskOptions, Pixels } from "../src/types.js";

/** Build a solid or per-pixel RGBA buffer. */
function pixels(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number?],
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

function solid(width: number, height: number, r: number, g: number, b: number): Pixels {
  return pixels(width, height, () => [r, g, b]);
}

function baseOpts(over: Partial<MaskOptions> = {}): MaskOptions {
  return {
    source: "luminance",
    low: 0,
    high: 1,
    softness: 0,
    invert: false,
    dither: "bayer8",
    ...over,
  };
}

describe("computeCoverage", () => {
  it("hard band (softness 0): inside [low,high] is 1, well outside is 0", () => {
    // mid-gray ~0.216 linear luminance; white ~1; black 0
    const src = pixels(3, 1, (x) => {
      if (x === 0) return [0, 0, 0];
      if (x === 1) return [128, 128, 128];
      return [255, 255, 255];
    });
    const midY = relativeLuminance(128, 128, 128);
    const cov = computeCoverage(
      src,
      baseOpts({ low: midY - 0.05, high: midY + 0.05, softness: 0 }),
    );
    expect(cov[0]).toBe(0);
    expect(cov[1]).toBe(1);
    expect(cov[2]).toBe(0);
  });

  // Guards the no-blur requirement: coverage[i] is a pure function of pixel i
  // alone (for luminance). A blur-based implementation cannot pass this test.
  it("no spatial feather: coverage permutes identically when pixels are shuffled", () => {
    const w = 32;
    const h = 32;
    const n = w * h;
    const src = pixels(w, h, (x, y) => {
      const v = ((x * 17 + y * 31) * 7) % 256;
      return [v, v, v];
    });
    const cov = computeCoverage(
      src,
      baseOpts({ low: 0.2, high: 0.7, softness: 0.15 }),
    );

    // Fixed permutation of pixel indices (cycle by 97 steps, coprime to n).
    const perm = new Uint32Array(n);
    for (let i = 0; i < n; i++) perm[i] = (i * 97) % n;

    const shuffled = pixels(w, h, (x, y) => {
      const i = y * w + x;
      const j = perm[i]!;
      const sx = j % w;
      const sy = (j / w) | 0;
      const k = (sy * w + sx) * 4;
      return [src.data[k]!, src.data[k + 1]!, src.data[k + 2]!, src.data[k + 3]!];
    });
    const covShuffled = computeCoverage(
      shuffled,
      baseOpts({ low: 0.2, high: 0.7, softness: 0.15 }),
    );

    const expected = new Float32Array(n);
    for (let i = 0; i < n; i++) expected[i] = cov[perm[i]!]!;
    expect(Array.from(covShuffled)).toEqual(Array.from(expected));
  });

  it("softness produces a ramp: coverage rises then falls with at least one interior value", () => {
    // Luminance increases left to right (gray ramp).
    const w = 64;
    const h = 1;
    const src = pixels(w, h, (x) => {
      const v = Math.round((x / (w - 1)) * 255);
      return [v, v, v];
    });
    const cov = computeCoverage(
      src,
      baseOpts({ low: 0.3, high: 0.6, softness: 0.2 }),
    );

    let sawRise = false;
    let sawFall = false;
    let sawInterior = false;
    for (let i = 1; i < w; i++) {
      if (cov[i]! > cov[i - 1]!) sawRise = true;
      if (cov[i]! < cov[i - 1]!) sawFall = true;
      if (cov[i]! > 0 && cov[i]! < 1) sawInterior = true;
    }
    expect(sawRise).toBe(true);
    expect(sawFall).toBe(true);
    expect(sawInterior).toBe(true);
  });

  it("invert: true yields exactly 1 - c for every pixel", () => {
    const src = pixels(8, 8, (x, y) => {
      const v = ((x + y * 3) * 13) % 256;
      return [v, (v * 2) % 256, (v * 3) % 256];
    });
    const opts = baseOpts({ low: 0.25, high: 0.75, softness: 0.1 });
    const a = computeCoverage(src, { ...opts, invert: false });
    const b = computeCoverage(src, { ...opts, invert: true });
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs(b[i]! - (1 - a[i]!))).toBeLessThanOrEqual(1e-6);
    }
  });

  it("saturation source: gray is 0 in band [0.5,1]; pure red is 1", () => {
    const gray = solid(4, 4, 128, 128, 128);
    const red = solid(4, 4, 255, 0, 0);
    const opts = baseOpts({
      source: "saturation",
      low: 0.5,
      high: 1,
      softness: 0,
    });
    const g = computeCoverage(gray, opts);
    const r = computeCoverage(red, opts);
    for (let i = 0; i < g.length; i++) expect(g[i]).toBe(0);
    for (let i = 0; i < r.length; i++) expect(r[i]).toBe(1);
  });

  it("gradient source: flat is zero field; vertical step edge only near the edge", () => {
    const flat = solid(16, 8, 100, 100, 100);
    // Band excludes zero field values → all coverage 0 on a flat image.
    const flatCov = computeCoverage(
      flat,
      baseOpts({ source: "gradient", low: 1e-6, high: 1, softness: 0 }),
    );
    for (let i = 0; i < flatCov.length; i++) expect(flatCov[i]).toBe(0);

    // Vertical step: left half black, right half white. Edge between col 7 and 8.
    const mid = 8;
    const step = pixels(16, 8, (x) => (x < mid ? [0, 0, 0] : [255, 255, 255]));
    const stepCov = computeCoverage(
      step,
      baseOpts({ source: "gradient", low: 1e-6, high: 1, softness: 0 }),
    );

    const activeCols = new Set<number>();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        if (stepCov[y * 16 + x]! > 0) activeCols.add(x);
      }
    }
    // Non-zero gradient only in columns adjacent to the edge.
    for (const x of activeCols) {
      expect(x === mid - 1 || x === mid).toBe(true);
    }
    expect(activeCols.has(mid - 1)).toBe(true);
    expect(activeCols.has(mid)).toBe(true);
  });

  it("external source: matches external luminance band map; RangeError on missing/mismatch", () => {
    const src = solid(4, 3, 0, 0, 0);
    // External is a horizontal gray ramp; source is solid black.
    const external = pixels(4, 3, (x) => {
      const v = Math.round((x / 3) * 255);
      return [v, v, v];
    });
    const opts = baseOpts({
      source: "external",
      external,
      low: 0.2,
      high: 0.8,
      softness: 0.1,
    });
    const cov = computeCoverage(src, opts);
    // Same mapping applied to external alone as luminance source.
    const expected = computeCoverage(
      external,
      baseOpts({ source: "luminance", low: 0.2, high: 0.8, softness: 0.1 }),
    );
    expect(Array.from(cov)).toEqual(Array.from(expected));

    expect(() =>
      computeCoverage(src, baseOpts({ source: "external" })),
    ).toThrow(RangeError);

    const wrong = solid(2, 2, 255, 255, 255);
    expect(() =>
      computeCoverage(src, baseOpts({ source: "external", external: wrong })),
    ).toThrow(RangeError);
  });
});

describe("thresholdCoverage", () => {
  it("binary gate: output contains only 0 and 1 over a full spread of intermediates", () => {
    const w = 16;
    const h = 16;
    const coverage = new Float32Array(w * h);
    for (let i = 0; i < coverage.length; i++) {
      coverage[i] = i / (coverage.length - 1);
    }
    const gate = thresholdCoverage(coverage, w, h, "bayer8");
    for (let i = 0; i < gate.length; i++) {
      expect(gate[i] === 0 || gate[i] === 1).toBe(true);
    }
  });

  // A smooth-ramp (feathered) mask would produce at most one 0/1 transition on
  // a row of constant coverage; the ordered matrix breaks the falloff into a
  // field of individual dots, so we expect many transitions.
  it("falloff dissolves into dots: a mid-coverage row has both 0 and 1 and ≥4 transitions", () => {
    const w = 64;
    const h = 64;
    // Luminance depends only on y (vertical gradient).
    const src = pixels(w, h, (_x, y) => {
      const v = Math.round((y / (h - 1)) * 255);
      return [v, v, v];
    });
    const softness = 0.35;
    const cov = computeCoverage(
      src,
      baseOpts({ low: 0.4, high: 0.6, softness }),
    );

    // Find a row whose mean coverage is near 0.5.
    let bestY = 0;
    let bestDist = Infinity;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = 0; x < w; x++) sum += cov[y * w + x]!;
      const mean = sum / w;
      const d = Math.abs(mean - 0.5);
      if (d < bestDist) {
        bestDist = d;
        bestY = y;
      }
    }
    expect(bestDist).toBeLessThan(0.2);

    const gate = thresholdCoverage(cov, w, h, "bayer8");
    let zeros = 0;
    let ones = 0;
    let transitions = 0;
    let prev = gate[bestY * w]!;
    for (let x = 0; x < w; x++) {
      const g = gate[bestY * w + x]!;
      if (g === 0) zeros++;
      else ones++;
      if (x > 0 && g !== prev) transitions++;
      prev = g;
    }
    console.log(
      `falloff row y=${bestY}: ${transitions} transitions across ${w}px (${zeros} off, ${ones} on)`,
    );
    expect(zeros).toBeGreaterThan(0);
    expect(ones).toBeGreaterThan(0);
    expect(transitions).toBeGreaterThanOrEqual(4);
  });

  it("determinism: two calls with the same inputs return identical arrays", () => {
    const w = 12;
    const h = 9;
    const coverage = new Float32Array(w * h);
    for (let i = 0; i < coverage.length; i++) coverage[i] = (i % 17) / 16;
    const a = thresholdCoverage(coverage, w, h, "bayer4");
    const b = thresholdCoverage(coverage, w, h, "bayer4");
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("resolveMaskToCells / thresholdCoverageByCell", () => {
  it("cell grid dimensions: 10x7 with 4x3 cells → cols 3, rows 3, length 9 (ceil)", () => {
    const coverage = new Float32Array(10 * 7);
    coverage.fill(0.5);
    const { cells, cols, rows } = resolveMaskToCells(coverage, 10, 7, 4, 3);
    expect(cols).toBe(3);
    expect(rows).toBe(3);
    expect(cells.length).toBe(9);
  });

  it("no partially masked cells: gate is constant across every cell including partial edges", () => {
    const w = 10;
    const h = 7;
    const cellW = 4;
    const cellH = 3;
    const coverage = new Float32Array(w * h);
    for (let i = 0; i < coverage.length; i++) {
      coverage[i] = ((i * 13) % 100) / 100;
    }
    const gate = thresholdCoverageByCell(
      coverage,
      w,
      h,
      cellW,
      cellH,
      "bayer4",
    );
    const cols = Math.ceil(w / cellW);
    const rows = Math.ceil(h / cellH);

    for (let cy = 0; cy < rows; cy++) {
      const y0 = cy * cellH;
      const y1 = Math.min(y0 + cellH, h);
      for (let cx = 0; cx < cols; cx++) {
        const x0 = cx * cellW;
        const x1 = Math.min(x0 + cellW, w);
        const first = gate[y0 * w + x0]!;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            expect(gate[y * w + x]).toBe(first);
          }
        }
      }
    }
  });

  // Uniform coverage isolates the threshold: any variation in the gate can
  // only come from thresholdAt(matrix, cx, cy) differing per cell. Pixel-origin
  // indexing (thresholdAt(matrix, cx*cellWidth, cy*cellHeight)) with cellWidth
  // equal to the matrix period collapses each row to one threshold, so every
  // cell in a row would share the same gate.
  it("adjacent cells get distinct thresholds under uniform coverage", () => {
    const w = 64;
    const h = 60;
    const cellW = 8;
    const cellH = 12;
    const matrix = "bayer8" as const;
    const coverage = new Float32Array(w * h);
    coverage.fill(0.5);

    const gate = thresholdCoverageByCell(coverage, w, h, cellW, cellH, matrix);
    const cols = Math.ceil(w / cellW);
    const rows = Math.ceil(h / cellH);

    // One gate sample per cell (top-left pixel of each cell).
    const cellGate = (cx: number, cy: number) =>
      gate[(cy * cellH) * w + cx * cellW]!;

    let rowDiffers = false;
    for (let cx = 1; cx < cols; cx++) {
      if (cellGate(cx, 0) !== cellGate(cx - 1, 0)) {
        rowDiffers = true;
        break;
      }
    }
    expect(rowDiffers).toBe(true);

    let colDiffers = false;
    for (let cy = 1; cy < rows; cy++) {
      if (cellGate(0, cy) !== cellGate(0, cy - 1)) {
        colDiffers = true;
        break;
      }
    }
    expect(colDiffers).toBe(true);

    let zeros = 0;
    let ones = 0;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (cellGate(cx, cy) === 0) zeros++;
        else ones++;
      }
    }
    expect(zeros).toBeGreaterThan(0);
    expect(ones).toBeGreaterThan(0);
    const fractionOn = ones / (cols * rows);
    // bayer8 has half its thresholds below 0.5, so ~half the cells gate on.
    expect(fractionOn).toBeGreaterThan(0.3);
    expect(fractionOn).toBeLessThan(0.7);
  });

  // Pins the exact cell-coordinate indexing contract: expected gate is
  // cellValue > thresholdAt(matrix, cx, cy), not pixel-origin coordinates.
  it("cell gate matches explicit thresholdAt(matrix, cx, cy) reference", () => {
    const w = 64;
    const h = 60;
    const cellW = 8;
    const cellH = 12;
    const matrix = "bayer8" as const;
    const cols = Math.ceil(w / cellW);
    const rows = Math.ceil(h / cellH);

    // Distinct coverage per cell, filled across that cell's pixels.
    const coverage = new Float32Array(w * h);
    const cellValues = new Float32Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
      const y0 = cy * cellH;
      const y1 = Math.min(y0 + cellH, h);
      for (let cx = 0; cx < cols; cx++) {
        const cellIdx = cy * cols + cx;
        // Spread values across (0,1) so some pass and some fail each threshold.
        const value = ((cellIdx * 17 + 3) % 97) / 97;
        cellValues[cellIdx] = value;
        const x0 = cx * cellW;
        const x1 = Math.min(x0 + cellW, w);
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          for (let x = x0; x < x1; x++) {
            coverage[row + x] = value;
          }
        }
      }
    }

    const gate = thresholdCoverageByCell(coverage, w, h, cellW, cellH, matrix);

    for (let cy = 0; cy < rows; cy++) {
      const y0 = cy * cellH;
      const y1 = Math.min(y0 + cellH, h);
      for (let cx = 0; cx < cols; cx++) {
        const expected =
          cellValues[cy * cols + cx]! > thresholdAt(matrix, cx, cy) ? 1 : 0;
        const x0 = cx * cellW;
        const x1 = Math.min(x0 + cellW, w);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            expect(gate[y * w + x]).toBe(expected);
          }
        }
      }
    }
  });
});
