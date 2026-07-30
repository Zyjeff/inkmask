import { describe, it, expect } from "vitest";
import { halftoneEffect } from "../src/halftone.js";
import type { HalftoneEffect, Pixels, RGB } from "../src/types.js";

const FG: RGB = [10, 20, 30];
const BG: RGB = [200, 210, 220];

function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

function opts(overrides: Partial<HalftoneEffect> = {}): HalftoneEffect {
  return {
    kind: "halftone",
    cell: 4,
    angle: 45,
    shape: "circle",
    color: "mono",
    ...overrides,
  };
}

function collectRgb(px: Pixels): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < px.data.length; i += 4) {
    set.add(`${px.data[i]},${px.data[i + 1]},${px.data[i + 2]}`);
  }
  return set;
}

function countInk(px: Pixels, fg: RGB): number {
  let n = 0;
  for (let i = 0; i < px.data.length; i += 4) {
    if (px.data[i] === fg[0] && px.data[i + 1] === fg[1] && px.data[i + 2] === fg[2]) {
      n++;
    }
  }
  return n;
}

/** Count runs of consecutive ink pixels along a horizontal scanline. */
function inkRunsOnScanline(px: Pixels, y: number, fg: RGB): number {
  let runs = 0;
  let inRun = false;
  for (let x = 0; x < px.width; x++) {
    const i = (y * px.width + x) * 4;
    const ink =
      px.data[i] === fg[0] && px.data[i + 1] === fg[1] && px.data[i + 2] === fg[2];
    if (ink && !inRun) {
      runs++;
      inRun = true;
    } else if (!ink) {
      inRun = false;
    }
  }
  return runs;
}

describe("halftoneEffect mono colors", () => {
  it("output contains only the two given colors", () => {
    const src = solid(16, 16, 128, 128, 128);
    const out = halftoneEffect(src, opts(), FG, BG);
    const allowed = new Set([`${FG[0]},${FG[1]},${FG[2]}`, `${BG[0]},${BG[1]},${BG[2]}`]);
    for (const triple of collectRgb(out)) {
      expect(allowed.has(triple)).toBe(true);
    }
  });

  it("all-black input is entirely ink; all-white is entirely paper", () => {
    const black = solid(8, 8, 0, 0, 0);
    const white = solid(8, 8, 255, 255, 255);
    const blackOut = halftoneEffect(black, opts(), FG, BG);
    const whiteOut = halftoneEffect(white, opts(), FG, BG);
    expect(collectRgb(blackOut)).toEqual(new Set([`${FG[0]},${FG[1]},${FG[2]}`]));
    expect(collectRgb(whiteOut)).toEqual(new Set([`${BG[0]},${BG[1]},${BG[2]}`]));
  });
});

describe("halftoneEffect determinism and tone", () => {
  it("the same input twice produces byte-identical output", () => {
    const src = solid(12, 12, 100, 120, 140);
    const a = halftoneEffect(src, opts(), FG, BG);
    const b = halftoneEffect(src, opts(), FG, BG);
    expect(a.data).toEqual(b.data);
  });

  it("tone is monotonic: 25% luminance has more ink than 75%", () => {
    // Uniform mid-dark vs mid-light. sRGB values approximate linear L via relativeLuminance.
    // 0.25 and 0.75 linear → rough sRGB ~0.5 and ~0.88 → ~128 and ~224 as ballpark;
    // use exact values that relativeLuminance will treat as darker vs lighter.
    const dark = solid(24, 24, 64, 64, 64);
    const light = solid(24, 24, 192, 192, 192);
    const darkOut = halftoneEffect(dark, opts({ cell: 6 }), FG, BG);
    const lightOut = halftoneEffect(light, opts({ cell: 6 }), FG, BG);
    expect(countInk(darkOut, FG)).toBeGreaterThan(countInk(lightOut, FG));
  });

  it("angle 0 and angle 45 produce different output on mid-gray", () => {
    const src = solid(16, 16, 128, 128, 128);
    const a = halftoneEffect(src, opts({ angle: 0 }), FG, BG);
    const b = halftoneEffect(src, opts({ angle: 45 }), FG, BG);
    expect(a.data).not.toEqual(b.data);
  });

  it("circle and square produce different output at the same settings", () => {
    const src = solid(16, 16, 128, 128, 128);
    const a = halftoneEffect(src, opts({ shape: "circle" }), FG, BG);
    const b = halftoneEffect(src, opts({ shape: "square" }), FG, BG);
    expect(a.data).not.toEqual(b.data);
  });
});

describe("halftoneEffect cell size, immutability, alpha", () => {
  it("larger cell produces fewer ink runs along a scanline", () => {
    const src = solid(48, 48, 128, 128, 128);
    const small = halftoneEffect(src, opts({ cell: 4, angle: 0 }), FG, BG);
    const large = halftoneEffect(src, opts({ cell: 12, angle: 0 }), FG, BG);
    // Sum runs across several scanlines for stability
    let smallRuns = 0;
    let largeRuns = 0;
    for (let y = 0; y < 48; y++) {
      smallRuns += inkRunsOnScanline(small, y, FG);
      largeRuns += inkRunsOnScanline(large, y, FG);
    }
    expect(largeRuns).toBeLessThan(smallRuns);
  });

  it("does not mutate the input Pixels.data", () => {
    const src = solid(8, 8, 50, 100, 150, 200);
    const snapshot = new Uint8ClampedArray(src.data);
    halftoneEffect(src, opts(), FG, BG);
    expect(src.data).toEqual(snapshot);
  });

  it("preserves alpha byte for byte", () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = (i / 4) * 4; // varying alpha
    }
    const src: Pixels = { data, width: w, height: h };
    const out = halftoneEffect(src, opts(), FG, BG);
    for (let i = 0; i < data.length; i += 4) {
      expect(out.data[i + 3]).toBe(data[i + 3]);
    }
  });
});
