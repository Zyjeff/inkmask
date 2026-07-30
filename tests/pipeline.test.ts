import { describe, it, expect } from "vitest";
import { applyInkmask, DEFAULTS } from "../src/index.js";
import type { MaskOptions, Pixels } from "../src/types.js";

/** Build a per-pixel RGBA buffer. */
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

function solid(width: number, height: number, r: number, g: number, b: number, a = 255): Pixels {
  return pixels(width, height, () => [r, g, b, a]);
}

function arraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe("applyInkmask", () => {
  /**
   * Correctness requirement 1 — the mask is computed from the undithered source.
   *
   * Coverage and gate must not depend on the effect matrix. Switching only
   * effect.matrix (bayer4 vs blueNoise) must leave coverage and gate
   * byte-identical, while the pixel outputs must actually differ so the test
   * cannot pass by ignoring the effect entirely.
   */
  it("Correctness requirement 1: mask is computed from the undithered source", () => {
    const src = pixels(32, 32, (x, y) => {
      const v = ((x * 13 + y * 29) * 5) % 256;
      return [v, v, v];
    });
    const mask: Partial<MaskOptions> = {
      source: "luminance",
      low: 0,
      high: 0.5,
      softness: 0.15,
      invert: false,
      dither: "bayer8",
    };

    const a = applyInkmask(src, {
      mask,
      effect: { kind: "dither", matrix: "bayer4" },
    });
    const b = applyInkmask(src, {
      mask,
      effect: { kind: "dither", matrix: "blueNoise" },
    });

    expect(arraysEqual(a.coverage, b.coverage)).toBe(true);
    expect(arraysEqual(a.gate, b.gate)).toBe(true);
    expect(arraysEqual(a.pixels.data, b.pixels.data)).toBe(false);
  });

  /**
   * Correctness requirement 2 — the mask threshold is dithered, not feathered.
   * Softness creates a value-domain ramp; the gate must still be binary 0/1
   * with ordered-dither transitions, never intermediate alphas.
   */
  it("Correctness requirement 2: mask threshold is dithered, not feathered", () => {
    const w = 64;
    const h = 64;
    // Luminance depends only on y: black at top → white at bottom.
    const src = pixels(w, h, (_x, y) => {
      const v = Math.round((y / (h - 1)) * 255);
      return [v, v, v];
    });

    const { coverage, gate } = applyInkmask(src, {
      mask: {
        source: "luminance",
        low: 0,
        high: 0.5,
        softness: 0.2,
        invert: false,
        dither: "bayer8",
      },
      effect: { kind: "dither", matrix: "bayer4" },
    });

    // Find the row whose mean coverage is closest to 0.5.
    let bestRow = 0;
    let bestDist = Infinity;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = 0; x < w; x++) sum += coverage[y * w + x]!;
      const mean = sum / w;
      const dist = Math.abs(mean - 0.5);
      if (dist < bestDist) {
        bestDist = dist;
        bestRow = y;
      }
    }

    let has0 = false;
    let has1 = false;
    let transitions = 0;
    let prev = gate[bestRow * w]!;
    for (let x = 0; x < w; x++) {
      const g = gate[bestRow * w + x]!;
      expect(g === 0 || g === 1).toBe(true);
      if (g === 0) has0 = true;
      if (g === 1) has1 = true;
      if (x > 0 && g !== prev) transitions++;
      prev = g;
    }

    expect(has0).toBe(true);
    expect(has1).toBe(true);
    expect(transitions).toBeGreaterThanOrEqual(4);
    console.log(`pipeline mask-gate horizontal transitions (row ${bestRow}): ${transitions}`);
  });

  /**
   * Correctness requirement 3 — luminance is computed in linear space.
   * Uniform sRGB 128 gray has linear luminance ≈ 0.2159, but raw sRGB ≈ 0.502.
   * The band [0.18, 0.25] brackets the linear value and excludes the sRGB one,
   * so an implementation thresholding in sRGB would return all zeros here.
   */
  it("Correctness requirement 3: luminance is computed in linear space", () => {
    const src = solid(8, 8, 128, 128, 128);
    const { coverage } = applyInkmask(src, {
      mask: { low: 0.18, high: 0.25, softness: 0 },
    });
    for (let i = 0; i < coverage.length; i++) {
      expect(coverage[i]).toBe(1);
    }
  });

  /**
   * Untouched regions stay untouched — where gate is 0, output pixels must be
   * byte-identical to the source, including alpha. This is the property the
   * whole library exists to provide.
   */
  it("untouched regions stay untouched (gate 0 → source bytes)", () => {
    const src = pixels(16, 16, (x, y) => {
      const v = ((x * 11 + y * 19) * 3) % 256;
      return [v, (v * 2) % 256, (v * 3) % 256, 200 + (x % 56)];
    });

    // Soft band so some pixels are fully gated off (coverage below dither threshold).
    const { pixels: out, gate } = applyInkmask(src, {
      mask: {
        source: "luminance",
        low: 0,
        high: 0.35,
        softness: 0.1,
        invert: false,
        dither: "bayer8",
      },
      effect: { kind: "dither", matrix: "bayer4", color: "mono" },
      foreground: "#ff0000",
      background: "#00ff00",
    });

    let gatedOff = 0;
    for (let i = 0; i < gate.length; i++) {
      if (gate[i] !== 0) continue;
      gatedOff++;
      const o = i * 4;
      expect(out.data[o]).toBe(src.data[o]);
      expect(out.data[o + 1]).toBe(src.data[o + 1]);
      expect(out.data[o + 2]).toBe(src.data[o + 2]);
      expect(out.data[o + 3]).toBe(src.data[o + 3]);
    }
    // Sanity: the mask must actually turn some pixels off.
    expect(gatedOff).toBeGreaterThan(0);
  });

  it("invert: true produces the exact complement of invert: false", () => {
    // Hard band → coverage is only 0 or 1, so no exact ties with the dither
    // threshold (thresholds lie strictly in (0, 1)). Gate is therefore the
    // exact binary complement under invert.
    const src = pixels(24, 24, (x, y) => {
      const v = ((x * 17 + y * 31) * 7) % 256;
      return [v, v, v];
    });
    const baseMask = {
      source: "luminance" as const,
      low: 0.1,
      high: 0.4,
      softness: 0,
      dither: "bayer8" as const,
    };

    const plain = applyInkmask(src, {
      mask: { ...baseMask, invert: false },
      effect: { kind: "dither" },
    });
    const inverted = applyInkmask(src, {
      mask: { ...baseMask, invert: true },
      effect: { kind: "dither" },
    });

    for (let i = 0; i < plain.gate.length; i++) {
      expect(inverted.gate[i]).toBe(1 - plain.gate[i]!);
    }
  });

  it("option merging: partial mask keeps every other mask default", () => {
    const src = pixels(16, 16, (x, y) => {
      const v = ((x + y * 3) * 11) % 256;
      return [v, v, v];
    });

    const partial = applyInkmask(src, { mask: { low: 0.2 } });
    const explicit = applyInkmask(src, {
      mask: {
        source: DEFAULTS.mask.source,
        low: 0.2,
        high: DEFAULTS.mask.high,
        softness: DEFAULTS.mask.softness,
        invert: DEFAULTS.mask.invert,
        dither: DEFAULTS.mask.dither,
      },
      effect: DEFAULTS.effect,
      blend: DEFAULTS.blend,
      opacity: DEFAULTS.opacity,
      foreground: DEFAULTS.foreground,
      background: DEFAULTS.background,
    });

    expect(arraysEqual(partial.coverage, explicit.coverage)).toBe(true);
    expect(arraysEqual(partial.gate, explicit.gate)).toBe(true);
    expect(arraysEqual(partial.pixels.data, explicit.pixels.data)).toBe(true);
  });

  it('unimplemented effect "halftone" throws mentioning the name', () => {
    const src = solid(4, 4, 128, 128, 128);
    expect(() =>
      applyInkmask(src, { effect: { kind: "halftone" } }),
    ).toThrow(/halftone/);
  });

  it('unimplemented effect "ascii" throws mentioning the name', () => {
    const src = solid(4, 4, 128, 128, 128);
    expect(() =>
      applyInkmask(src, { effect: { kind: "ascii" } }),
    ).toThrow(/ascii/);
  });
});
