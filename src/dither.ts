import type { DitherEffect, Pixels, RGB } from "./types.js";
import { relativeLuminance } from "./color.js";
import { thresholdAt } from "./matrix.js";

/**
 * Ordered-dither the entire source image.
 * Returns a new Pixels; the input is not mutated.
 * Alpha is 255 for ink and 0 for paper when `bg` is null; otherwise paper is opaque `bg`.
 */
export function ditherEffect(src: Pixels, opts: DitherEffect, fg: RGB, bg: RGB | null): Pixels {
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
      const t = thresholdAt(opts.matrix, Math.floor(x / scale), Math.floor(y / scale));
      const Y = relativeLuminance(r, g, b);
      // Darker than threshold → ink; lighter → paper
      const ink = Y <= t;

      if (ink) {
        if (opts.color === "mono") {
          out[i] = fg[0];
          out[i + 1] = fg[1];
          out[i + 2] = fg[2];
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
        out[i + 3] = 255;
      } else if (bg !== null) {
        out[i] = bg[0];
        out[i + 1] = bg[1];
        out[i + 2] = bg[2];
        out[i + 3] = 255;
      } else {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      }
    }
  }

  return { data: out, width, height };
}
