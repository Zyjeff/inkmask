import type { HalftoneEffect, Pixels, RGB } from "./types.js";
import { relativeLuminance } from "./color.js";

/**
 * Render the entire source as a rotated halftone screen.
 * Returns a new Pixels; the input is not mutated.
 * Alpha is 255 for ink and 0 for paper when `bg` is null; otherwise paper is opaque `bg`.
 */
export function halftoneEffect(src: Pixels, opts: HalftoneEffect, fg: RGB, bg: RGB | null): Pixels {
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(data.length);
  const cell = opts.cell;
  const rad = (opts.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mono = opts.color === "mono";
  const circle = opts.shape === "circle";
  const negative = opts.polarity === "negative";

  // ── Pass 1: per-cell tone map over the rotated image AABB ─────────────────
  // Rotate the four image corners to find the screen-space bounding box.
  let rxMin = Infinity;
  let rxMax = -Infinity;
  let ryMin = Infinity;
  let ryMax = -Infinity;
  const corners: readonly [number, number][] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  for (let c = 0; c < 4; c++) {
    const x = corners[c]![0];
    const y = corners[c]![1];
    const rx = x * cos + y * sin;
    const ry = -x * sin + y * cos;
    if (rx < rxMin) rxMin = rx;
    if (rx > rxMax) rxMax = rx;
    if (ry < ryMin) ryMin = ry;
    if (ry > ryMax) ryMax = ry;
  }

  const cxMin = Math.floor(rxMin / cell);
  const cxMax = Math.floor(rxMax / cell);
  const cyMin = Math.floor(ryMin / cell);
  const cyMax = Math.floor(ryMax / cell);
  const cols = cxMax - cxMin + 1;
  const nCells = cols * (cyMax - cyMin + 1);

  // Indexed (cy - cyMin) * cols + (cx - cxMin)
  const tone = new Float32Array(nCells);
  const meanR = new Float32Array(nCells);
  const meanG = new Float32Array(nCells);
  const meanB = new Float32Array(nCells);
  // Empty cells (no in-bounds samples) keep L=1 → no ink under positive polarity.
  tone.fill(1);

  for (let cy = cyMin; cy <= cyMax; cy++) {
    for (let cx = cxMin; cx <= cxMax; cx++) {
      const idx = (cy - cyMin) * cols + (cx - cxMin);
      let sumL = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let n = 0;

      // 4×4 sample grid spread inside the cell in screen space
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const srx = (cx + (i + 0.5) / 4) * cell;
          const sry = (cy + (j + 0.5) / 4) * cell;
          // Rotate sample back into image space; only count samples that land inside
          const sx = Math.round(srx * cos - sry * sin);
          const sy = Math.round(srx * sin + sry * cos);
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

          const si = (sy * width + sx) * 4;
          const r = data[si]!;
          const g = data[si + 1]!;
          const b = data[si + 2]!;
          sumL += relativeLuminance(r, g, b);
          sumR += r;
          sumG += g;
          sumB += b;
          n++;
        }
      }

      if (n > 0) {
        tone[idx] = sumL / n;
        meanR[idx] = sumR / n;
        meanG[idx] = sumG / n;
        meanB[idx] = sumB / n;
      }
    }
  }

  // ── Pass 2: rasterise per pixel ───────────────────────────────────────────
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Rotate into screen space
      const rx = x * cos + y * sin;
      const ry = -x * sin + y * cos;

      // Locate the screen cell and its center
      const cx = Math.floor(rx / cell);
      const cy = Math.floor(ry / cell);
      const ccx = (cx + 0.5) * cell;
      const ccy = (cy + 0.5) * cell;

      // Look up precomputed cell tone and mean colour
      let L = 1;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      if (cx >= cxMin && cx <= cxMax && cy >= cyMin && cy <= cyMax) {
        const idx = (cy - cyMin) * cols + (cx - cxMin);
        L = tone[idx]!;
        sr = meanR[idx]!;
        sg = meanG[idx]!;
        sb = meanB[idx]!;
      }

      // Dot extent: positive grows as image darkens; negative grows in the bright zone
      const extent = (negative ? L : 1 - L) * cell * 0.5 * Math.SQRT2;
      let ink: boolean;
      if (circle) {
        const dx = rx - ccx;
        const dy = ry - ccy;
        ink = dx * dx + dy * dy <= extent * extent;
      } else {
        ink = Math.max(Math.abs(rx - ccx), Math.abs(ry - ccy)) <= extent;
      }

      // Emit colors — ink always alpha 255; paper is bg or transparent
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
