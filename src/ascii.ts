import type { AsciiEffect, Pixels, RGB } from "./types.js";
import { relativeLuminance } from "./color.js";

export interface AsciiGrid {
  cols: number;
  rows: number;
  /** One glyph per cell, row-major. Length cols*rows. */
  chars: string[];
  /** Mean source color per cell, row-major. Length cols*rows. */
  colors: RGB[];
}

/** Pure: map the source to a glyph grid. No DOM. */
export function asciiGrid(src: Pixels, opts: AsciiEffect): AsciiGrid {
  const { data, width, height } = src;
  const { cellWidth, cellHeight, ramp } = opts;
  // Same ceil geometry as resolveMaskToCells — partial edge cells are real cells.
  const cols = Math.ceil(width / cellWidth);
  const rows = Math.ceil(height / cellHeight);
  const chars: string[] = new Array(cols * rows);
  const colors: RGB[] = new Array(cols * rows);
  const last = ramp.length - 1;

  for (let cy = 0; cy < rows; cy++) {
    const y0 = cy * cellHeight;
    const y1 = Math.min(y0 + cellHeight, height);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * cellWidth;
      const x1 = Math.min(x0 + cellWidth, width);
      let sumL = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          const i = (row + x) * 4;
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          sumL += relativeLuminance(r, g, b);
          sumR += r;
          sumG += g;
          sumB += b;
          count++;
        }
      }
      const L = count > 0 ? sumL / count : 0;
      let idx = Math.round(L * last);
      if (idx < 0) idx = 0;
      else if (idx > last) idx = last;

      const ci = cy * cols + cx;
      chars[ci] = ramp.charAt(idx);
      colors[ci] = [
        Math.round(count > 0 ? sumR / count : 0),
        Math.round(count > 0 ? sumG / count : 0),
        Math.round(count > 0 ? sumB / count : 0),
      ];
    }
  }

  return { cols, rows, chars, colors };
}

// =============================================================================
// BROWSER ONLY — requires document/canvas. Not exercised by Node tests.
// asciiEffect is verified in the browser harness instead.
// =============================================================================

/** Browser only: rasterize a glyph grid into a Pixels buffer. */
export function asciiEffect(src: Pixels, opts: AsciiEffect, fg: RGB, bg: RGB): Pixels {
  const grid = asciiGrid(src, opts);
  const { width, height } = src;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  ctx.fillRect(0, 0, width, height);
  ctx.font = opts.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const { cols, rows, chars, colors } = grid;
  const { cellWidth, cellHeight } = opts;
  const mono = opts.color === "mono";

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      const color = mono ? fg : colors[i]!;
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      const x = (cx + 0.5) * cellWidth;
      const y = (cy + 0.5) * cellHeight;
      ctx.fillText(chars[i]!, x, y);
    }
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}
