import type { DitherEffect, Pixels, RGB } from "./types.js";
import { relativeLuminance } from "./color.js";
import { thresholdAt } from "./matrix.js";

/**
 * Ordered-dither the entire source image.
 * Returns a new Pixels; the input is not mutated. Alpha is copied through.
 */
export function ditherEffect(src: Pixels, opts: DitherEffect, fg: RGB, bg: RGB): Pixels {
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(data.length);
  const scale = opts.scale;
  const n = opts.levels;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      const t = thresholdAt(opts.matrix, Math.floor(x / scale), Math.floor(y / scale));

      if (opts.color === "mono") {
        const Y = relativeLuminance(r, g, b);
        const [or, og, ob] = Y > t ? bg : fg;
        out[i] = or;
        out[i + 1] = og;
        out[i + 2] = ob;
      } else {
        const denom = n - 1;
        const quant = (v: number): number => {
          let q = Math.floor((v / 255) * denom + t);
          if (q < 0) q = 0;
          else if (q > denom) q = denom;
          return Math.round((q / denom) * 255);
        };
        out[i] = quant(r);
        out[i + 1] = quant(g);
        out[i + 2] = quant(b);
      }
      out[i + 3] = a;
    }
  }

  return { data: out, width, height };
}
