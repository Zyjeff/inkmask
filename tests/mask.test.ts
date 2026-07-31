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
    space: "linear",
    angle: 0,
    centerX: 0.5,
    centerY: 0.5,
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
  // Scoped to the luminance source only -- cannot apply to positional sources,
  // whose coverage depends on position rather than pixel value.
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

  it("linear ramp at 0 degrees: varies left to right, constant down each column", () => {
    const w = 32;
    const h = 16;
    const src = solid(w, h, 128, 128, 128);
    // Soft tent map recovers continuous field ≈ coverage via low=high=0, soft=1:
    // c = min(v+1, 1-v) = 1-v for v in [0,1], so field = 1 - c.
    const soft = computeCoverage(
      src,
      baseOpts({
        source: "linear",
        angle: 0,
        low: 0,
        high: 0,
        softness: 1,
      }),
    );
    // Leftmost column field near 0, rightmost near 1.
    for (let y = 0; y < h; y++) {
      const leftField = 1 - soft[y * w + 0]!;
      const rightField = 1 - soft[y * w + (w - 1)]!;
      expect(leftField).toBeLessThan(0.05);
      expect(rightField).toBeGreaterThan(0.95);
    }
    // Constant down any column (coverage identical ⇒ field identical).
    for (let x = 0; x < w; x++) {
      const top = soft[x]!;
      for (let y = 1; y < h; y++) {
        expect(soft[y * w + x]!).toBeCloseTo(top, 5);
      }
    }
    // Wide hard band [0,1] covers everything (sanity).
    const full = computeCoverage(
      src,
      baseOpts({ source: "linear", angle: 0, low: 0, high: 1, softness: 0 }),
    );
    for (let i = 0; i < full.length; i++) expect(full[i]).toBe(1);

    // Narrow band selects a vertical slab near mid-image.
    const slab = computeCoverage(
      src,
      baseOpts({
        source: "linear",
        angle: 0,
        low: 0.45,
        high: 0.55,
        softness: 0,
      }),
    );
    let minOnX = w;
    let maxOnX = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (slab[y * w + x]! === 1) {
          if (x < minOnX) minOnX = x;
          if (x > maxOnX) maxOnX = x;
        }
      }
    }
    expect(maxOnX).toBeGreaterThanOrEqual(minOnX);
    // Slab is a contiguous vertical band (not full width).
    expect(minOnX).toBeGreaterThan(0);
    expect(maxOnX).toBeLessThan(w - 1);
    // Every on-pixel shares the same column range across rows.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const on = slab[y * w + x]! === 1;
        if (x >= minOnX && x <= maxOnX) expect(on).toBe(true);
        else expect(on).toBe(false);
      }
    }
  });

  it("linear ramp at 90 degrees: varies top to bottom, constant across each row", () => {
    const w = 16;
    const h = 32;
    const src = solid(w, h, 200, 100, 50);
    // Recover field via soft map: field = 1 - c when low=high=0, soft=1.
    const soft = computeCoverage(
      src,
      baseOpts({
        source: "linear",
        angle: 90,
        low: 0,
        high: 0,
        softness: 1,
      }),
    );
    for (let x = 0; x < w; x++) {
      expect(1 - soft[0 * w + x]!).toBeLessThan(0.05);
      expect(1 - soft[(h - 1) * w + x]!).toBeGreaterThan(0.95);
    }
    for (let y = 0; y < h; y++) {
      const left = soft[y * w]!;
      for (let x = 1; x < w; x++) {
        expect(soft[y * w + x]!).toBeCloseTo(left, 5);
      }
    }
  });

  it("linear angle normalisation: at 45 degrees field still reaches near-0 and near-1", () => {
    const w = 48;
    const h = 48;
    const src = solid(w, h, 0, 0, 0);
    // Probe extremes with narrow hard bands at each end of the field range.
    // Without the |cos|+|sin| denom, a diagonal ramp never reaches both ends.
    const near0 = computeCoverage(
      src,
      baseOpts({
        source: "linear",
        angle: 45,
        low: 0,
        high: 0.05,
        softness: 0,
      }),
    );
    const near1 = computeCoverage(
      src,
      baseOpts({
        source: "linear",
        angle: 45,
        low: 0.95,
        high: 1,
        softness: 0,
      }),
    );
    let hit0 = false;
    let hit1 = false;
    for (let i = 0; i < near0.length; i++) {
      if (near0[i]! === 1) hit0 = true;
      if (near1[i]! === 1) hit1 = true;
    }
    expect(hit0).toBe(true);
    expect(hit1).toBe(true);
  });

  it("radial: symmetric about centre, increases outward; centre < corner", () => {
    const w = 33;
    const h = 33;
    const src = solid(w, h, 64, 64, 64);
    // Recover continuous field via soft map: field = 1 - c.
    const soft = computeCoverage(
      src,
      baseOpts({
        source: "radial",
        centerX: 0.5,
        centerY: 0.5,
        low: 0,
        high: 0,
        softness: 1,
      }),
    );
    const field = (i: number) => 1 - soft[i]!;
    const cx = (w - 1) >> 1;
    const cy = (h - 1) >> 1;
    const centre = field(cy * w + cx);
    const corner = field(0);
    expect(centre).toBeLessThan(corner);
    expect(centre).toBeLessThan(0.05);
    // Symmetry about centre: value at (cx+dx, cy+dy) ≈ (cx-dx, cy-dy).
    for (let dy = 0; dy <= cy; dy++) {
      for (let dx = 0; dx <= cx; dx++) {
        const a = field((cy + dy) * w + (cx + dx));
        const b = field((cy - dy) * w + (cx - dx));
        expect(a).toBeCloseTo(b, 5);
      }
    }
    // Increases with distance from centre along a ray.
    const midEdge = field(cy * w + (w - 1));
    expect(centre).toBeLessThan(midEdge);
    expect(midEdge).toBeLessThanOrEqual(corner + 1e-5);
  });

  it("radial centre offset: moving centerX shifts where the minimum falls", () => {
    const w = 41;
    const h = 21;
    const src = solid(w, h, 10, 20, 30);
    // Soft map so coverage encodes the field (field = 1 - c).
    const left = computeCoverage(
      src,
      baseOpts({
        source: "radial",
        centerX: 0.25,
        centerY: 0.5,
        low: 0,
        high: 0,
        softness: 1,
      }),
    );
    const right = computeCoverage(
      src,
      baseOpts({
        source: "radial",
        centerX: 0.75,
        centerY: 0.5,
        low: 0,
        high: 0,
        softness: 1,
      }),
    );
    // Find column of minimum field on the middle row for each.
    const midY = (h - 1) >> 1;
    const minCol = (cov: Float32Array) => {
      let bestX = 0;
      let bestV = Infinity;
      for (let x = 0; x < w; x++) {
        const v = 1 - cov[midY * w + x]!;
        if (v < bestV) {
          bestV = v;
          bestX = x;
        }
      }
      return bestX;
    };
    const leftMin = minCol(left);
    const rightMin = minCol(right);
    expect(leftMin).toBeLessThan(w / 2);
    expect(rightMin).toBeGreaterThan(w / 2);
    expect(rightMin).toBeGreaterThan(leftMin);
  });

  it("positional sources ignore pixel content: same geometry, different pixels → identical coverage", () => {
    const w = 20;
    const h = 12;
    const a = solid(w, h, 0, 0, 0);
    const b = pixels(w, h, (x, y) => {
      const v = ((x * 41 + y * 17) * 9) % 256;
      return [v, 255 - v, (v * 3) % 256];
    });
    for (const source of ["linear", "radial"] as const) {
      const opts = baseOpts({
        source,
        angle: 30,
        centerX: 0.3,
        centerY: 0.7,
        low: 0.2,
        high: 0.8,
        softness: 0.1,
      });
      const ca = computeCoverage(a, opts);
      const cb = computeCoverage(b, opts);
      expect(Array.from(ca)).toEqual(Array.from(cb));
    }
  });

  // Acceptance test for threshold units: sRGB mid-grey is ~0.5 in picker units
  // but ~0.216 in linear light. space: "srgb" lets designers aim with the former.
  it("sRGB space, luminance source: band around 0.5 covers sRGB 128; linear space does not", () => {
    const src = solid(8, 8, 128, 128, 128);
    const band = { low: 0.45, high: 0.55, softness: 0 as const };
    const srgbCov = computeCoverage(
      src,
      baseOpts({ source: "luminance", space: "srgb", ...band }),
    );
    const linearCov = computeCoverage(
      src,
      baseOpts({ source: "luminance", space: "linear", ...band }),
    );
    for (let i = 0; i < srgbCov.length; i++) expect(srgbCov[i]).toBe(1);
    for (let i = 0; i < linearCov.length; i++) expect(linearCov[i]).toBe(0);
  });

  it("sRGB space is ignored for non-luminance sources (saturation)", () => {
    const src = pixels(8, 8, (x, y) => {
      const v = ((x + y * 5) * 19) % 256;
      return [v, (v * 2) % 256, (v * 3) % 256];
    });
    const common = {
      source: "saturation" as const,
      low: 0.2,
      high: 0.9,
      softness: 0.05,
    };
    const a = computeCoverage(src, baseOpts({ ...common, space: "srgb" }));
    const b = computeCoverage(src, baseOpts({ ...common, space: "linear" }));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("linear space remains the default behaviour for existing band mapping", () => {
    // mid-gray ~0.216 linear luminance; white ~1; black 0
    const src = pixels(3, 1, (x) => {
      if (x === 0) return [0, 0, 0];
      if (x === 1) return [128, 128, 128];
      return [255, 255, 255];
    });
    const midY = relativeLuminance(128, 128, 128);
    const cov = computeCoverage(
      src,
      baseOpts({
        space: "linear",
        low: midY - 0.05,
        high: midY + 0.05,
        softness: 0,
      }),
    );
    expect(cov[0]).toBe(0);
    expect(cov[1]).toBe(1);
    expect(cov[2]).toBe(0);
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
