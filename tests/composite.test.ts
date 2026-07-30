import { describe, it, expect } from "vitest";
import { blendRGB, composite } from "../src/composite.js";
import type { Pixels, RGB } from "../src/types.js";

function px(
  width: number,
  height: number,
  rgba: number[],
): Pixels {
  return {
    data: new Uint8ClampedArray(rgba),
    width,
    height,
  };
}

describe("composite", () => {
  it("untouched pass-through: all-zero gate leaves base data byte-identical", () => {
    const base = px(2, 2, [
      10, 20, 30, 255, 40, 50, 60, 200, 70, 80, 90, 100, 110, 120, 130, 50,
    ]);
    const effect = px(2, 2, [
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 4,
    ]);
    const gate = new Uint8Array([0, 0, 0, 0]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 1 });
    expect(out.data).toEqual(base.data);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
  });

  it("all-one gate with normal/opacity 1 takes effect RGB and base alpha", () => {
    const base = px(1, 2, [10, 20, 30, 200, 40, 50, 60, 100]);
    // Alpha must be 255: coverage is now alpha-scaled; opaque ink replaces the base.
    const effect = px(1, 2, [255, 128, 64, 255, 0, 1, 2, 255]);
    const gate = new Uint8Array([1, 1]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 1 });
    expect(out.data[0]).toBe(255);
    expect(out.data[1]).toBe(128);
    expect(out.data[2]).toBe(64);
    expect(out.data[3]).toBe(200);
    expect(out.data[4]).toBe(0);
    expect(out.data[5]).toBe(1);
    expect(out.data[6]).toBe(2);
    expect(out.data[7]).toBe(100);
  });

  it("mixed gate changes only gated pixels", () => {
    const base = px(2, 2, [
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
    ]);
    // Alpha must be 255: coverage is now alpha-scaled; opaque ink replaces the base.
    const effect = px(2, 2, [
      200, 201, 202, 255, 210, 211, 212, 255, 220, 221, 222, 255, 230, 231, 232, 255,
    ]);
    const gate = new Uint8Array([1, 0, 1, 0]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 1 });

    // gated (0,0) and (1,0) → effect RGB, base alpha
    expect(out.data[0]).toBe(200);
    expect(out.data[1]).toBe(201);
    expect(out.data[2]).toBe(202);
    expect(out.data[3]).toBe(255);
    expect(out.data[8]).toBe(220);
    expect(out.data[9]).toBe(221);
    expect(out.data[10]).toBe(222);
    expect(out.data[11]).toBe(255);

    // ungated (0,1) and (1,1) → byte-identical to base
    expect(out.data[4]).toBe(base.data[4]);
    expect(out.data[5]).toBe(base.data[5]);
    expect(out.data[6]).toBe(base.data[6]);
    expect(out.data[7]).toBe(base.data[7]);
    expect(out.data[12]).toBe(base.data[12]);
    expect(out.data[13]).toBe(base.data[13]);
    expect(out.data[14]).toBe(base.data[14]);
    expect(out.data[15]).toBe(base.data[15]);
  });

  it("opacity 0.5 normal: base 0 and effect 200 → 100", () => {
    const base = px(1, 1, [0, 0, 0, 255]);
    const effect = px(1, 1, [200, 200, 200, 255]);
    const gate = new Uint8Array([1]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 0.5 });
    expect(out.data[0]).toBe(100);
    expect(out.data[1]).toBe(100);
    expect(out.data[2]).toBe(100);
  });

  it("opacity 0 leaves base byte-identical even where gate is 1", () => {
    const base = px(1, 1, [10, 20, 30, 40]);
    const effect = px(1, 1, [200, 210, 220, 230]);
    const gate = new Uint8Array([1]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 0 });
    expect(out.data).toEqual(base.data);
  });

  it("blend modes at mid and high values", () => {
    const mid: RGB = [128, 128, 128];
    const mul = blendRGB("multiply", mid, mid);
    const scr = blendRGB("screen", mid, mid);
    const ovr = blendRGB("overlay", mid, mid);
    expect(Math.abs(mul[0] - 64)).toBeLessThanOrEqual(1);
    expect(Math.abs(scr[0] - 192)).toBeLessThanOrEqual(1);
    // Overlay takes the >=0.5 branch here (128/255 = 0.502), so mid-gray over
    // mid-gray stays mid-gray: 1 - 2*(1-b)*(1-e) = 0.5039 -> 128.
    expect(Math.abs(ovr[0] - 128)).toBeLessThanOrEqual(1);

    const ovrHi = blendRGB("overlay", [200, 200, 200], [128, 128, 128]);
    expect(Math.abs(ovrHi[0] - 200)).toBeLessThanOrEqual(1);
  });

  it("screen is never darker than either input; multiply never lighter", () => {
    const values = [0, 32, 64, 96, 128, 160, 192, 224, 255];
    for (const b of values) {
      for (const e of values) {
        const base: RGB = [b, b, b];
        const effect: RGB = [e, e, e];
        const scr = blendRGB("screen", base, effect);
        const mul = blendRGB("multiply", base, effect);
        expect(scr[0]).toBeGreaterThanOrEqual(Math.max(b, e));
        expect(mul[0]).toBeLessThanOrEqual(Math.min(b, e));
      }
    }
  });

  it("does not mutate base or effect data", () => {
    const base = px(1, 1, [10, 20, 30, 40]);
    const effect = px(1, 1, [200, 210, 220, 230]);
    const baseSnap = new Uint8ClampedArray(base.data);
    const effectSnap = new Uint8ClampedArray(effect.data);
    const gate = new Uint8Array([1]);
    composite(base, effect, gate, { blend: "multiply", opacity: 0.7 });
    expect(base.data).toEqual(baseSnap);
    expect(effect.data).toEqual(effectSnap);
  });

  it("throws RangeError on mismatched dimensions and wrong-length gate", () => {
    const base = px(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]);
    const effect = px(1, 1, [0, 0, 0, 255]);
    expect(() =>
      composite(base, effect, new Uint8Array([1, 1]), {
        blend: "normal",
        opacity: 1,
      }),
    ).toThrow(RangeError);

    const same = px(1, 1, [0, 0, 0, 255]);
    expect(() =>
      composite(same, same, new Uint8Array([1, 0]), {
        blend: "normal",
        opacity: 1,
      }),
    ).toThrow(RangeError);
  });

  it("transparent ink leaves the base untouched", () => {
    const base = px(2, 2, [
      10, 20, 30, 255, 40, 50, 60, 200, 70, 80, 90, 100, 110, 120, 130, 50,
    ]);
    // Wildly different RGB, but alpha 0 everywhere
    const effect = px(2, 2, [
      255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 1, 2, 3, 0,
    ]);
    const gate = new Uint8Array([1, 1, 1, 1]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 1 });
    expect(out.data).toEqual(base.data);
  });

  it("opaque ink still fully replaces", () => {
    const base = px(1, 2, [10, 20, 30, 200, 40, 50, 60, 100]);
    const effect = px(1, 2, [255, 128, 64, 255, 0, 1, 2, 255]);
    const gate = new Uint8Array([1, 1]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 1 });
    expect(out.data[0]).toBe(255);
    expect(out.data[1]).toBe(128);
    expect(out.data[2]).toBe(64);
    expect(out.data[3]).toBe(200);
    expect(out.data[4]).toBe(0);
    expect(out.data[5]).toBe(1);
    expect(out.data[6]).toBe(2);
    expect(out.data[7]).toBe(100);
  });

  it("mixed alpha within one buffer (ink/paper pattern)", () => {
    const base = px(2, 2, [
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
    ]);
    // alpha [255, 0, 255, 0]
    const effect = px(2, 2, [
      200, 201, 202, 255, 210, 211, 212, 0, 220, 221, 222, 255, 230, 231, 232, 0,
    ]);
    const gate = new Uint8Array([1, 1, 1, 1]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 1 });

    // alpha-255 pixels take effect RGB, keep base alpha
    expect(out.data[0]).toBe(200);
    expect(out.data[1]).toBe(201);
    expect(out.data[2]).toBe(202);
    expect(out.data[3]).toBe(255);
    expect(out.data[8]).toBe(220);
    expect(out.data[9]).toBe(221);
    expect(out.data[10]).toBe(222);
    expect(out.data[11]).toBe(255);

    // alpha-0 pixels stay byte-identical to base
    expect(out.data[4]).toBe(base.data[4]);
    expect(out.data[5]).toBe(base.data[5]);
    expect(out.data[6]).toBe(base.data[6]);
    expect(out.data[7]).toBe(base.data[7]);
    expect(out.data[12]).toBe(base.data[12]);
    expect(out.data[13]).toBe(base.data[13]);
    expect(out.data[14]).toBe(base.data[14]);
    expect(out.data[15]).toBe(base.data[15]);
  });

  it("alpha and opacity multiply equivalently", () => {
    const base = px(1, 1, [0, 50, 100, 255]);
    const effectRgb = [200, 150, 50] as const;
    const gate = new Uint8Array([1]);

    const viaAlpha = composite(
      base,
      px(1, 1, [effectRgb[0], effectRgb[1], effectRgb[2], 128]),
      gate,
      { blend: "normal", opacity: 1 },
    );
    const viaOpacity = composite(
      base,
      px(1, 1, [effectRgb[0], effectRgb[1], effectRgb[2], 255]),
      gate,
      { blend: "normal", opacity: 128 / 255 },
    );

    for (let c = 0; c < 3; c++) {
      expect(Math.abs(viaAlpha.data[c]! - viaOpacity.data[c]!)).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it("blend modes still apply through alpha", () => {
    const base = px(1, 1, [128, 128, 128, 255]);
    const gate = new Uint8Array([1]);

    // alpha 255 + screen: matches blendRGB screen result (opaque path)
    const opaque = composite(
      base,
      px(1, 1, [128, 128, 128, 255]),
      gate,
      { blend: "screen", opacity: 1 },
    );
    const expected = blendRGB("screen", [128, 128, 128], [128, 128, 128]);
    expect(Math.abs(opaque.data[0]! - expected[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(opaque.data[1]! - expected[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(opaque.data[2]! - expected[2])).toBeLessThanOrEqual(1);

    // alpha 0 + screen: base untouched
    const transparent = composite(
      base,
      px(1, 1, [255, 0, 0, 0]),
      gate,
      { blend: "screen", opacity: 1 },
    );
    expect(transparent.data).toEqual(base.data);
  });

  it("base alpha is preserved regardless of effect alpha", () => {
    const base = px(2, 2, [
      10, 20, 30, 10, 40, 50, 60, 80, 70, 80, 90, 160, 110, 120, 130, 255,
    ]);
    const effect = px(2, 2, [
      255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 200, 1, 2, 3, 255,
    ]);
    const gate = new Uint8Array([1, 1, 1, 1]);
    const out = composite(base, effect, gate, { blend: "normal", opacity: 1 });
    expect(out.data[3]).toBe(10);
    expect(out.data[7]).toBe(80);
    expect(out.data[11]).toBe(160);
    expect(out.data[15]).toBe(255);
  });
});
