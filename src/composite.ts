import type { BlendMode, Pixels, RGB } from "./types.js";

/** Blend two 8-bit sRGB triples. Operates in sRGB space, as blend modes conventionally do. */
export function blendRGB(mode: BlendMode, base: RGB, effect: RGB): RGB {
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const b = base[i]! / 255;
    const e = effect[i]! / 255;
    let r: number;
    switch (mode) {
      case "normal":
        r = e;
        break;
      case "multiply":
        r = b * e;
        break;
      case "screen":
        r = 1 - (1 - b) * (1 - e);
        break;
      case "overlay":
        r = b < 0.5 ? 2 * b * e : 1 - 2 * (1 - b) * (1 - e);
        break;
    }
    out[i] = Math.round(r * 255);
  }
  return out;
}

/**
 * Effect layer over base layer, gated by a binary mask.
 * `gate` contains only 0 and 1 and has length width*height.
 * Where gate is 0 the base pixel is copied through byte-identically.
 * Returns a new Pixels. Neither input is mutated. Base alpha is preserved.
 */
export function composite(
  base: Pixels,
  effect: Pixels,
  gate: Uint8Array,
  opts: { blend: BlendMode; opacity: number },
): Pixels {
  if (base.width !== effect.width || base.height !== effect.height) {
    throw new RangeError("base and effect dimensions must match");
  }
  if (gate.length !== base.width * base.height) {
    throw new RangeError("gate length must equal base.width * base.height");
  }

  const { blend, opacity } = opts;
  const n = base.width * base.height;
  const out = new Uint8ClampedArray(base.data.length);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (gate[i] === 0) {
      out[o] = base.data[o]!;
      out[o + 1] = base.data[o + 1]!;
      out[o + 2] = base.data[o + 2]!;
      out[o + 3] = base.data[o + 3]!;
      continue;
    }

    const blended = blendRGB(
      blend,
      [base.data[o]!, base.data[o + 1]!, base.data[o + 2]!],
      [effect.data[o]!, effect.data[o + 1]!, effect.data[o + 2]!],
    );
    out[o] = Math.round(base.data[o]! + (blended[0] - base.data[o]!) * opacity);
    out[o + 1] = Math.round(
      base.data[o + 1]! + (blended[1] - base.data[o + 1]!) * opacity,
    );
    out[o + 2] = Math.round(
      base.data[o + 2]! + (blended[2] - base.data[o + 2]!) * opacity,
    );
    out[o + 3] = base.data[o + 3]!;
  }

  return { data: out, width: base.width, height: base.height };
}
