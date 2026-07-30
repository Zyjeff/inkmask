import { describe, it, expect } from "vitest";
import {
  srgbToLinear,
  linearToSrgb,
  relativeLuminance,
  saturation,
  luminanceField,
  saturationField,
  parseHex,
} from "../src/color.js";
import type { Pixels } from "../src/types.js";

describe("srgbToLinear / linearToSrgb", () => {
  it("maps 0 and 1 to themselves", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBe(1);
  });

  it("is continuous at the 0.04045 knee within 1e-6", () => {
    const c = 0.04045;
    const linearBranch = c / 12.92;
    const powerBranch = ((c + 0.055) / 1.055) ** 2.4;
    expect(Math.abs(linearBranch - powerBranch)).toBeLessThanOrEqual(1e-6);
    expect(srgbToLinear(c)).toBeCloseTo(linearBranch, 6);
  });

  it("srgbToLinear(0.5) is within 1e-6 of 0.2140411", () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140411, 6);
  });

  it("round-trips linearToSrgb(srgbToLinear(c)) for sample values", () => {
    for (const c of [0, 0.01, 0.04, 0.5, 0.9, 1]) {
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 9);
    }
  });
});

describe("relativeLuminance", () => {
  it("correctness requirement 3: luminance is computed in linear-light, not sRGB", () => {
    const y = relativeLuminance(128, 128, 128);
    expect(y).toBeCloseTo(0.21586, 4);
    expect(y).toBeCloseTo(srgbToLinear(128 / 255), 12);
    // Fails if someone thresholds in sRGB space instead of linear.
    expect(Math.abs(y - 128 / 255)).toBeGreaterThan(0.25);
  });

  it("uses Rec.709 weights and green > red > blue", () => {
    const red = relativeLuminance(255, 0, 0);
    const green = relativeLuminance(0, 255, 0);
    const blue = relativeLuminance(0, 0, 255);
    expect(red).toBeCloseTo(0.2126, 6);
    expect(green).toBeCloseTo(0.7152, 6);
    expect(blue).toBeCloseTo(0.0722, 6);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it("black is 0 and white is ~1", () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 9);
  });
});

describe("saturation", () => {
  it("returns 0 for gray and black, 1 for pure red, and mid for tinted red", () => {
    expect(saturation(128, 128, 128)).toBe(0);
    expect(saturation(0, 0, 0)).toBe(0);
    expect(saturation(255, 0, 0)).toBe(1);
    const s = saturation(255, 200, 200);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("luminanceField / saturationField", () => {
  it("matches scalar functions on a hand-built 3x2 buffer", () => {
    // 3x2 pixels, RGBA groups of 4
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, // black
      255, 255, 255, 255, // white
      128, 128, 128, 255, // gray
      255, 0, 0, 255, // red
      0, 255, 0, 255, // green
      255, 200, 200, 200, // tinted; alpha ignored
    ]);
    const px: Pixels = { data, width: 3, height: 2 };

    const lum = luminanceField(px);
    const sat = saturationField(px);
    expect(lum.length).toBe(6);
    expect(sat.length).toBe(6);

    const channels: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [128, 128, 128],
      [255, 0, 0],
      [0, 255, 0],
      [255, 200, 200],
    ];
    for (let i = 0; i < 6; i++) {
      const [r, g, b] = channels[i]!;
      // Float32Array truncates; compare at float32 precision.
      expect(lum[i]).toBe(Math.fround(relativeLuminance(r, g, b)));
      expect(sat[i]).toBe(Math.fround(saturation(r, g, b)));
    }
  });
});

describe("parseHex", () => {
  it("parses #rgb and #rrggbb", () => {
    expect(parseHex("#000")).toEqual([0, 0, 0]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#ff8000")).toEqual([255, 128, 0]);
  });

  it("throws on invalid input", () => {
    expect(() => parseHex("red")).toThrow();
    expect(() => parseHex("#gg0000")).toThrow();
  });
});
