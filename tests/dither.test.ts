import { describe, it, expect } from "vitest";
import { ditherEffect } from "../src/dither.js";
import type { DitherEffect, Pixels, RGB } from "../src/types.js";

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

function monoOpts(overrides: Partial<DitherEffect> = {}): DitherEffect {
  return {
    kind: "dither",
    matrix: "bayer8",
    levels: 2,
    scale: 1,
    color: "mono",
    ...overrides,
  };
}

function sourceOpts(overrides: Partial<DitherEffect> = {}): DitherEffect {
  return {
    kind: "dither",
    matrix: "bayer8",
    levels: 2,
    scale: 1,
    color: "source",
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

function countAlpha255(px: Pixels): number {
  let n = 0;
  for (let i = 3; i < px.data.length; i += 4) {
    if (px.data[i] === 255) n++;
  }
  return n;
}

describe("ditherEffect mono", () => {
  it("output contains only the two given colors", () => {
    const src = solid(8, 8, 128, 128, 128);
    const out = ditherEffect(src, monoOpts(), FG, BG);
    const allowed = new Set([`${FG[0]},${FG[1]},${FG[2]}`, `${BG[0]},${BG[1]},${BG[2]}`]);
    for (const triple of collectRgb(out)) {
      expect(allowed.has(triple)).toBe(true);
    }
  });

  it("all-black input is entirely fg; all-white is entirely bg", () => {
    const black = solid(4, 4, 0, 0, 0);
    const white = solid(4, 4, 255, 255, 255);
    const blackOut = ditherEffect(black, monoOpts(), FG, BG);
    const whiteOut = ditherEffect(white, monoOpts(), FG, BG);
    expect(collectRgb(blackOut)).toEqual(new Set([`${FG[0]},${FG[1]},${FG[2]}`]));
    expect(collectRgb(whiteOut)).toEqual(new Set([`${BG[0]},${BG[1]},${BG[2]}`]));
  });
});

describe("ditherEffect determinism and matrix switch", () => {
  it("dithering the same input twice produces byte-identical output", () => {
    const src = solid(8, 8, 100, 120, 140);
    const a = ditherEffect(src, monoOpts(), FG, BG);
    const b = ditherEffect(src, monoOpts(), FG, BG);
    expect(a.data).toEqual(b.data);
  });

  // Another unit asserts the mask is unchanged when the effect's matrix switches.
  // That assertion is only meaningful if switching the matrix genuinely changes
  // the effect layer — so bayer8 and blueNoise must produce different output.
  it("bayer8 and blueNoise produce different output on mid-gray", () => {
    const src = solid(16, 16, 128, 128, 128);
    const a = ditherEffect(src, monoOpts({ matrix: "bayer8" }), FG, BG);
    const b = ditherEffect(src, monoOpts({ matrix: "blueNoise" }), FG, BG);
    expect(a.data).not.toEqual(b.data);
  });
});

describe("ditherEffect source mode", () => {
  it("levels: 2 emits only 0 and 255 in each RGB channel of ink pixels", () => {
    const src = solid(8, 8, 128, 90, 200);
    const out = ditherEffect(src, sourceOpts({ levels: 2 }), FG, null);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] !== 255) continue;
      expect([0, 255]).toContain(out.data[i]);
      expect([0, 255]).toContain(out.data[i + 1]);
      expect([0, 255]).toContain(out.data[i + 2]);
    }
  });

  it("levels: 4 emits only the four expected quantization steps per channel of ink pixels", () => {
    // q in 0..3 → Math.round(q / 3 * 255) = 0, 85, 170, 255
    const steps = [0, 85, 170, 255];
    const src = solid(8, 8, 64, 128, 200);
    const out = ditherEffect(src, sourceOpts({ levels: 4 }), FG, null);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] !== 255) continue;
      expect(steps).toContain(out.data[i]);
      expect(steps).toContain(out.data[i + 1]);
      expect(steps).toContain(out.data[i + 2]);
    }
  });
});

describe("ditherEffect scale, immutability, alpha", () => {
  it("scale: 2 produces 2x2 constant blocks on flat mid-gray", () => {
    const src = solid(8, 8, 128, 128, 128);
    const out = ditherEffect(src, monoOpts({ scale: 2 }), FG, BG);
    for (let y = 0; y < 8; y += 2) {
      for (let x = 0; x < 8; x += 2) {
        const base = (y * 8 + x) * 4;
        const r0 = out.data[base]!;
        const g0 = out.data[base + 1]!;
        const b0 = out.data[base + 2]!;
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          const i = ((y + dy) * 8 + (x + dx)) * 4;
          expect(out.data[i]).toBe(r0);
          expect(out.data[i + 1]).toBe(g0);
          expect(out.data[i + 2]).toBe(b0);
        }
      }
    }
  });

  it("does not mutate the input Pixels.data", () => {
    const src = solid(4, 4, 50, 100, 150, 200);
    const snapshot = new Uint8ClampedArray(src.data);
    ditherEffect(src, monoOpts(), FG, BG);
    ditherEffect(src, monoOpts(), FG, null);
    expect(src.data).toEqual(snapshot);
  });

  it("alpha is 255 for ink and 0 for paper when bg is null", () => {
    const src = solid(8, 8, 128, 128, 128);
    const out = ditherEffect(src, monoOpts(), FG, null);
    for (let i = 0; i < out.data.length; i += 4) {
      expect([0, 255]).toContain(out.data[i + 3]);
    }
    expect(countAlpha255(out)).toBeGreaterThan(0);
    expect(countAlpha255(out)).toBeLessThan(out.width * out.height);
  });
});

describe("ditherEffect transparent paper contract", () => {
  it("transparent paper: mid-gray yields mixed alpha 0/255 only", () => {
    const src = solid(16, 16, 128, 128, 128);
    const out = ditherEffect(src, monoOpts(), FG, null);
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
    const out = ditherEffect(src, monoOpts(), FG, null);
    const inkColors = collectInkRgb(out);
    expect(inkColors.size).toBeGreaterThan(0);
    for (const triple of inkColors) {
      expect(triple).toBe(`${FG[0]},${FG[1]},${FG[2]}`);
    }
  });

  it("opaque mode: every pixel alpha 255 and RGB subset of {fg, bg}", () => {
    const src = solid(16, 16, 128, 128, 128);
    const out = ditherEffect(src, monoOpts(), FG, BG);
    const allowed = new Set([`${FG[0]},${FG[1]},${FG[2]}`, `${BG[0]},${BG[1]},${BG[2]}`]);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i + 3]).toBe(255);
    }
    for (const triple of collectRgb(out)) {
      expect(allowed.has(triple)).toBe(true);
    }
  });

  it("ink coverage tracks tone: darker input has more alpha-255 pixels", () => {
    const dark = solid(16, 16, 64, 64, 64);
    const light = solid(16, 16, 192, 192, 192);
    const darkOut = ditherEffect(dark, monoOpts(), FG, null);
    const lightOut = ditherEffect(light, monoOpts(), FG, null);
    expect(countAlpha255(darkOut)).toBeGreaterThan(countAlpha255(lightOut));
  });

  it("all-black is entirely alpha 255; all-white is entirely alpha 0 (mono, bg null)", () => {
    const black = solid(8, 8, 0, 0, 0);
    const white = solid(8, 8, 255, 255, 255);
    const blackOut = ditherEffect(black, monoOpts(), FG, null);
    const whiteOut = ditherEffect(white, monoOpts(), FG, null);
    expect(countAlpha255(blackOut)).toBe(black.width * black.height);
    expect(countAlpha255(whiteOut)).toBe(0);
    for (let i = 3; i < whiteOut.data.length; i += 4) {
      expect(whiteOut.data[i]).toBe(0);
    }
  });

  it("does not mutate the input Pixels.data (transparent path)", () => {
    const src = solid(4, 4, 50, 100, 150, 200);
    const snapshot = new Uint8ClampedArray(src.data);
    ditherEffect(src, monoOpts(), FG, null);
    expect(src.data).toEqual(snapshot);
  });
});
