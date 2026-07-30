import type { MaskOptions, MatrixKind, Pixels } from "./types.js";
import { luminanceField, saturationField } from "./color.js";
import { thresholdAt } from "./matrix.js";

/**
 * Continuous mask coverage in 0-1, computed from the UNDITHERED source.
 * Length is width*height. Deliberately has no knowledge of the effect.
 */
export function computeCoverage(src: Pixels, opts: MaskOptions): Float32Array {
  const { width, height } = src;
  const n = width * height;
  const field = sourceField(src, opts);
  const out = new Float32Array(n);
  const s = opts.softness;
  const low = opts.low;
  const high = opts.high;
  const inv = opts.invert;

  // softness is a ramp width in VALUE units (source-field 0-1), not pixels.
  // Spatial feathering is intentionally absent; the ordered-dither gate
  // produces the dotted falloff after this pure per-pixel band map.
  for (let i = 0; i < n; i++) {
    const v = field[i]!;
    let c: number;
    if (s <= 0) {
      c = v >= low && v <= high ? 1 : 0;
    } else {
      c = Math.min((v - (low - s)) / s, (high + s - v) / s);
      if (c < 0) c = 0;
      else if (c > 1) c = 1;
    }
    out[i] = inv ? 1 - c : c;
  }
  return out;
}

/** Mean coverage per cell. cols/rows use ceil, so partial edge cells are included. */
export function resolveMaskToCells(
  coverage: Float32Array,
  width: number,
  height: number,
  cellWidth: number,
  cellHeight: number,
): { cells: Float32Array; cols: number; rows: number } {
  const cols = Math.ceil(width / cellWidth);
  const rows = Math.ceil(height / cellHeight);
  const cells = new Float32Array(cols * rows);

  for (let cy = 0; cy < rows; cy++) {
    const y0 = cy * cellHeight;
    const y1 = Math.min(y0 + cellHeight, height);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * cellWidth;
      const x1 = Math.min(x0 + cellWidth, width);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          sum += coverage[row + x]!;
          count++;
        }
      }
      cells[cy * cols + cx] = count > 0 ? sum / count : 0;
    }
  }
  return { cells, cols, rows };
}

/** Threshold coverage per pixel against an ordered matrix. Contains only 0 and 1. */
export function thresholdCoverage(
  coverage: Float32Array,
  width: number,
  height: number,
  matrix: MatrixKind,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      out[i] = coverage[i]! > thresholdAt(matrix, x, y) ? 1 : 0;
    }
  }
  return out;
}

/**
 * Cell-resolved gate for glyph effects. Coverage is averaged per cell and
 * thresholded once per cell, indexed by CELL coordinates, so no cell is ever
 * partially masked. Returned length is still width*height, constant per cell.
 */
export function thresholdCoverageByCell(
  coverage: Float32Array,
  width: number,
  height: number,
  cellWidth: number,
  cellHeight: number,
  matrix: MatrixKind,
): Uint8Array {
  const { cells, cols, rows } = resolveMaskToCells(
    coverage,
    width,
    height,
    cellWidth,
    cellHeight,
  );
  const out = new Uint8Array(width * height);

  for (let cy = 0; cy < rows; cy++) {
    const y0 = cy * cellHeight;
    const y1 = Math.min(y0 + cellHeight, height);
    for (let cx = 0; cx < cols; cx++) {
      const gate = cells[cy * cols + cx]! > thresholdAt(matrix, cx, cy) ? 1 : 0;
      const x0 = cx * cellWidth;
      const x1 = Math.min(x0 + cellWidth, width);
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          out[row + x] = gate;
        }
      }
    }
  }
  return out;
}

function sourceField(src: Pixels, opts: MaskOptions): Float32Array {
  switch (opts.source) {
    case "luminance":
      return luminanceField(src);
    case "saturation":
      return saturationField(src);
    case "gradient":
      return sobelMagnitude(luminanceField(src), src.width, src.height);
    case "external": {
      const ext = opts.external;
      if (!ext) {
        throw new RangeError('Mask source "external" requires opts.external');
      }
      if (ext.width !== src.width || ext.height !== src.height) {
        throw new RangeError(
          `External mask dimensions ${ext.width}x${ext.height} differ from source ${src.width}x${src.height}`,
        );
      }
      return luminanceField(ext);
    }
  }
}

/** Sobel magnitude of a scalar field. Fixed 0-1 normalization; edge coords clamp. */
function sobelMagnitude(
  field: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height);
  const inv = 1 / (4 * Math.SQRT2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sample = (dx: number, dy: number): number => {
        let sx = x + dx;
        let sy = y + dy;
        if (sx < 0) sx = 0;
        else if (sx >= width) sx = width - 1;
        if (sy < 0) sy = 0;
        else if (sy >= height) sy = height - 1;
        return field[sy * width + sx]!;
      };

      // gx = [[-1,0,1],[-2,0,2],[-1,0,1]], gy = transpose
      const gx =
        -sample(-1, -1) +
        sample(1, -1) +
        -2 * sample(-1, 0) +
        2 * sample(1, 0) +
        -sample(-1, 1) +
        sample(1, 1);
      const gy =
        -sample(-1, -1) +
        -2 * sample(0, -1) +
        -sample(1, -1) +
        sample(-1, 1) +
        2 * sample(0, 1) +
        sample(1, 1);

      let m = Math.sqrt(gx * gx + gy * gy) * inv;
      if (m < 0) m = 0;
      else if (m > 1) m = 1;
      out[y * width + x] = m;
    }
  }
  return out;
}
