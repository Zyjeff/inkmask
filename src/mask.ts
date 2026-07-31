import type { MaskOptions, MatrixKind, Pixels } from "./types.js";
import { linearToSrgb, luminanceField, saturationField } from "./color.js";
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

  // When space is "srgb" for luminance/external, remap the linear field to
  // sRGB units so the band (low/high/softness) can be aimed with colour-picker
  // values. Luminance is still COMPUTED in linear light; only the comparison
  // units change. Other sources leave the field untouched.
  const remapSrgb =
    opts.space === "srgb" &&
    (opts.source === "luminance" || opts.source === "external");

  // softness is a ramp width in VALUE units (source-field 0-1), not pixels.
  // Spatial feathering is intentionally absent; the ordered-dither gate
  // produces the dotted falloff after this pure per-pixel band map.
  //
  // Positional mask sources ("linear", "radial") are NOT spatial feathering.
  // The no-blur rule forbids smoothing a mask field across neighbouring
  // pixels; a positional ramp is an input to the mask, still evaluated per
  // pixel with no neighbourhood access, and its falloff is still resolved
  // by the ordered-dither gate.
  for (let i = 0; i < n; i++) {
    let v = field[i]!;
    if (remapSrgb) v = linearToSrgb(v);
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
    case "linear":
      return linearField(src.width, src.height, opts.angle);
    case "radial":
      return radialField(src.width, src.height, opts.centerX, opts.centerY);
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

/**
 * Positional linear ramp. Pure function of (x, y); no neighbourhood access.
 * Angle 0 runs left to right. The |cos|+|sin| denominator normalises the
 * projection so t spans exactly 0..1 at any angle.
 */
function linearField(
  width: number,
  height: number,
  angleDeg: number,
): Float32Array {
  const out = new Float32Array(width * height);
  const a = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const denom = Math.abs(cosA) + Math.abs(sinA);
  const invW = width <= 1 ? 0 : 1 / (width - 1);
  const invH = height <= 1 ? 0 : 1 / (height - 1);

  for (let y = 0; y < height; y++) {
    const ny = y * invH - 0.5;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const nx = x * invW - 0.5;
      // denom is zero only if cos and sin are both zero, which never happens.
      const t = 0.5 + (nx * cosA + ny * sinA) / denom;
      out[row + x] = t;
    }
  }
  return out;
}

/**
 * Positional radial ramp. Distance from centre in normalised image coords,
 * divided by the farthest corner distance, clamped to 0-1. Pure per-pixel.
 */
function radialField(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): Float32Array {
  const out = new Float32Array(width * height);
  // Max distance from centre to any of the four corners (in 0-1 image coords).
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  let maxDist = 0;
  for (const [cx, cy] of corners) {
    const dx = cx - centerX;
    const dy = cy - centerY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxDist) maxDist = d;
  }
  // If maxDist is 0 (degenerate 0-size / centre at a single point only), avoid /0.
  const invMax = maxDist > 0 ? 1 / maxDist : 0;
  const invW = width <= 1 ? 0 : 1 / (width - 1);
  const invH = height <= 1 ? 0 : 1 / (height - 1);

  for (let y = 0; y < height; y++) {
    const ny = height <= 1 ? centerY : y * invH;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const nx = width <= 1 ? centerX : x * invW;
      const dx = nx - centerX;
      const dy = ny - centerY;
      let t = Math.sqrt(dx * dx + dy * dy) * invMax;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      out[row + x] = t;
    }
  }
  return out;
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
