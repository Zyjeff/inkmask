import type { HalftoneEffect, Pixels, RGB } from "./types.js";
import { relativeLuminance } from "./color.js";

/**
 * Render the entire source as a rotated halftone screen.
 * Returns a new Pixels; the input is not mutated. Alpha is copied through.
 */
export function halftoneEffect(src: Pixels, opts: HalftoneEffect, fg: RGB, bg: RGB): Pixels {
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(data.length);
  const cell = opts.cell;
  const rad = (opts.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sqrt2 = Math.SQRT2;
  const mono = opts.color === "mono";
  const circle = opts.shape === "circle";

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // 1. Rotate into screen space
      const rx = x * cos + y * sin;
      const ry = -x * sin + y * cos;

      // 2. Locate the screen cell and its center
      const cx = Math.floor(rx / cell);
      const cy = Math.floor(ry / cell);
      const ccx = (cx + 0.5) * cell;
      const ccy = (cy + 0.5) * cell;

      // 3. Rotate center back into image space, sample luminance once per cell
      let sx = Math.round(ccx * cos - ccy * sin);
      let sy = Math.round(ccx * sin + ccy * cos);
      if (sx < 0) sx = 0;
      else if (sx >= width) sx = width - 1;
      if (sy < 0) sy = 0;
      else if (sy >= height) sy = height - 1;

      const si = (sy * width + sx) * 4;
      const sr = data[si]!;
      const sg = data[si + 1]!;
      const sb = data[si + 2]!;
      const L = relativeLuminance(sr, sg, sb);

      // 4. Size the dot from L (black fills cell; white is empty)
      const extent = (1 - L) * cell * 0.5 * sqrt2;
      let ink: boolean;
      if (circle) {
        const dx = rx - ccx;
        const dy = ry - ccy;
        ink = dx * dx + dy * dy <= extent * extent;
      } else {
        ink = Math.max(Math.abs(rx - ccx), Math.abs(ry - ccy)) <= extent;
      }

      // 5. Emit colors
      if (ink) {
        if (mono) {
          out[i] = fg[0];
          out[i + 1] = fg[1];
          out[i + 2] = fg[2];
        } else {
          out[i] = sr;
          out[i + 1] = sg;
          out[i + 2] = sb;
        }
      } else {
        out[i] = bg[0];
        out[i + 1] = bg[1];
        out[i + 2] = bg[2];
      }
      out[i + 3] = data[i + 3]!;
    }
  }

  return { data: out, width, height };
}
