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
    polarity: "positive",
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

function collectInkRgb(px: Pixels): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < px.data.length; i += 4) {
    if (px.data[i + 3] === 255) {
      set.add(`${px.data[i]},${px.data[i + 1]},${px.data[i + 2]}`);
    }
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

function countAlpha255(px: Pixels): number {
  let n = 0;
  for (let i = 3; i < px.data.length; i += 4) {
    if (px.data[i] === 255) n++;
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

  it("alpha is 255 for ink and 0 for paper when bg is null", () => {
    const src = solid(16, 16, 128, 128, 128);
    const out = halftoneEffect(src, opts(), FG, null);
    for (let i = 0; i < out.data.length; i += 4) {
      expect([0, 255]).toContain(out.data[i + 3]);
    }
    expect(countAlpha255(out)).toBeGreaterThan(0);
    expect(countAlpha255(out)).toBeLessThan(out.width * out.height);
  });
});

describe("halftoneEffect transparent paper contract", () => {
  it("transparent paper: mid-gray yields mixed alpha 0/255 only", () => {
    const src = solid(16, 16, 128, 128, 128);
    const out = halftoneEffect(src, opts(), FG, null);
    let has0 = false;
    let has255 = false;
    for (let i = 3; i < out.data.length; i += 4) {
      const a = out.data[i]!;
      expect(a === 0 || a === 255).toBe(true);
      if (a === 0) has0 = true;
      if (a === 255) has255 = true;
    }
    expect(has0).toBe(true);
    expect(has255).toBe(true);
  });

  it("ink pixels carry the foreground in mono with bg null", () => {
    const src = solid(16, 16, 128, 128, 128);
    const out = halftoneEffect(src, opts(), FG, null);
    const inkColors = collectInkRgb(out);
    expect(inkColors.size).toBeGreaterThan(0);
    for (const triple of inkColors) {
      expect(triple).toBe(`${FG[0]},${FG[1]},${FG[2]}`);
    }
  });

  it("opaque mode: every pixel alpha 255 and RGB subset of {fg, bg}", () => {
    const src = solid(16, 16, 128, 128, 128);
    const out = halftoneEffect(src, opts(), FG, BG);
    const allowed = new Set([`${FG[0]},${FG[1]},${FG[2]}`, `${BG[0]},${BG[1]},${BG[2]}`]);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i + 3]).toBe(255);
    }
    for (const triple of collectRgb(out)) {
      expect(allowed.has(triple)).toBe(true);
    }
  });

  it("ink coverage tracks tone: darker input has more alpha-255 pixels", () => {
    const dark = solid(24, 24, 64, 64, 64);
    const light = solid(24, 24, 192, 192, 192);
    const darkOut = halftoneEffect(dark, opts({ cell: 6 }), FG, null);
    const lightOut = halftoneEffect(light, opts({ cell: 6 }), FG, null);
    expect(countAlpha255(darkOut)).toBeGreaterThan(countAlpha255(lightOut));
  });

  it("all-black is entirely alpha 255; all-white is entirely alpha 0 (mono, bg null)", () => {
    const black = solid(8, 8, 0, 0, 0);
    const white = solid(8, 8, 255, 255, 255);
    const blackOut = halftoneEffect(black, opts(), FG, null);
    const whiteOut = halftoneEffect(white, opts(), FG, null);
    expect(countAlpha255(blackOut)).toBe(black.width * black.height);
    expect(countAlpha255(whiteOut)).toBe(0);
    for (let i = 3; i < whiteOut.data.length; i += 4) {
      expect(whiteOut.data[i]).toBe(0);
    }
  });

  it("does not mutate the input Pixels.data (transparent path)", () => {
    const src = solid(8, 8, 50, 100, 150, 200);
    const snapshot = new Uint8ClampedArray(src.data);
    halftoneEffect(src, opts(), FG, null);
    expect(src.data).toEqual(snapshot);
  });
});

describe("halftoneEffect polarity", () => {
  it("negative inverts dot growth vs positive on uniform bright and dark", () => {
    const bright = solid(24, 24, 220, 220, 220);
    const dark = solid(24, 24, 40, 40, 40);
    const settings = opts({ cell: 6 });
    const brightPos = countInk(
      halftoneEffect(bright, { ...settings, polarity: "positive" }, FG, BG),
      FG,
    );
    const brightNeg = countInk(
      halftoneEffect(bright, { ...settings, polarity: "negative" }, FG, BG),
      FG,
    );
    const darkPos = countInk(
      halftoneEffect(dark, { ...settings, polarity: "positive" }, FG, BG),
      FG,
    );
    const darkNeg = countInk(
      halftoneEffect(dark, { ...settings, polarity: "negative" }, FG, BG),
      FG,
    );
    // On bright input, negative (dots grow with L) yields strictly more ink than positive.
    expect(brightNeg).toBeGreaterThan(brightPos);
    // On dark input, negative yields strictly fewer ink pixels than positive.
    expect(darkNeg).toBeLessThan(darkPos);
  });

  it("negative extremes: all-black is transparent; all-white is entirely ink (mono, bg null)", () => {
    // Mirror of the positive extremes test: under negative polarity, L=0 → no extent, L=1 → full.
    const black = solid(8, 8, 0, 0, 0);
    const white = solid(8, 8, 255, 255, 255);
    const blackOut = halftoneEffect(black, opts({ polarity: "negative" }), FG, null);
    const whiteOut = halftoneEffect(white, opts({ polarity: "negative" }), FG, null);
    expect(countAlpha255(blackOut)).toBe(0);
    for (let i = 3; i < blackOut.data.length; i += 4) {
      expect(blackOut.data[i]).toBe(0);
    }
    expect(countAlpha255(whiteOut)).toBe(white.width * white.height);
  });

  it("polarity changes the bytes on the same input and settings", () => {
    const src = solid(16, 16, 128, 128, 128);
    const pos = halftoneEffect(src, opts({ polarity: "positive" }), FG, BG);
    const neg = halftoneEffect(src, opts({ polarity: "negative" }), FG, BG);
    expect(pos.data).not.toEqual(neg.data);
  });

  it("cell tone is averaged, not point-sampled", () => {
    // Vertical black/white stripes with period much finer than the cell size.
    // Averaging yields mid-gray tone → ink coverage between solid white (no ink) and
    // solid black (full ink). A centre-sampling implementation collapses to one
    // extreme or the other depending on where the cell centre lands — that is
    // exactly what this test distinguishes.
    const w = 36;
    const h = 36;
    // cell >> stripe period; non-power-of-two cell so the 4×4 sample grid hits both colours
    const cell = 12;
    const stripePeriod = 2;
    const stripes: Pixels = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Alternate columns black/white (period 2 << cell)
        const v = x % stripePeriod === 0 ? 0 : 255;
        stripes.data[i] = v;
        stripes.data[i + 1] = v;
        stripes.data[i + 2] = v;
        stripes.data[i + 3] = 255;
      }
    }
    const settings = opts({ cell, angle: 0, polarity: "positive" });
    const stripeOut = halftoneEffect(stripes, settings, FG, null);
    const whiteOut = halftoneEffect(solid(w, h, 255, 255, 255), settings, FG, null);
    const blackOut = halftoneEffect(solid(w, h, 0, 0, 0), settings, FG, null);
    const stripeInk = countAlpha255(stripeOut);
    const whiteInk = countAlpha255(whiteOut);
    const blackInk = countAlpha255(blackOut);
    expect(stripeInk).toBeGreaterThan(whiteInk);
    expect(stripeInk).toBeLessThan(blackInk);
  });

  it("determinism on the negative polarity path", () => {
    const src = solid(12, 12, 100, 120, 140);
    const a = halftoneEffect(src, opts({ polarity: "negative" }), FG, BG);
    const b = halftoneEffect(src, opts({ polarity: "negative" }), FG, BG);
    expect(a.data).toEqual(b.data);
  });

  it("does not mutate the input Pixels.data under negative polarity", () => {
    const src = solid(8, 8, 50, 100, 150, 200);
    const snapshot = new Uint8ClampedArray(src.data);
    halftoneEffect(src, opts({ polarity: "negative" }), FG, BG);
    expect(src.data).toEqual(snapshot);
  });
});
