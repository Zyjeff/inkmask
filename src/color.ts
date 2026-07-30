import type { Pixels, RGB } from "./types.js";

/** An sRGB channel value in 0-1, converted to linear-light 0-1. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear-light 0-1 back to gamma-encoded sRGB 0-1. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Rec.709 relative luminance in 0-1, from 8-bit sRGB channels. Converts to linear FIRST. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbToLinear(r / 255) +
    0.7152 * srgbToLinear(g / 255) +
    0.0722 * srgbToLinear(b / 255)
  );
}

/** Chroma-over-max saturation in 0-1, computed on LINEAR RGB, from 8-bit sRGB channels. */
export function saturation(r: number, g: number, b: number): number {
  // Saturation is computed on linear RGB for consistency with the luminance path.
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  const max = Math.max(lr, lg, lb);
  const min = Math.min(lr, lg, lb);
  return max <= 0 ? 0 : (max - min) / max;
}

/** Per-pixel Rec.709 linear luminance. Length is width*height. */
export function luminanceField(px: Pixels): Float32Array {
  const { data, width, height } = px;
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = relativeLuminance(data[j]!, data[j + 1]!, data[j + 2]!);
  }
  return out;
}

/** Per-pixel saturation. Length is width*height. */
export function saturationField(px: Pixels): Float32Array {
  const { data, width, height } = px;
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = saturation(data[j]!, data[j + 1]!, data[j + 2]!);
  }
  return out;
}

/** Parse "#rgb" or "#rrggbb" into an RGB triple. Throws on any other input. */
export function parseHex(hex: string): RGB {
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const r = parseInt(hex.charAt(1) + hex.charAt(1), 16);
    const g = parseInt(hex.charAt(2) + hex.charAt(2), 16);
    const b = parseInt(hex.charAt(3) + hex.charAt(3), 16);
    return [r, g, b];
  }
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }
  throw new Error(`Invalid hex color: ${hex}`);
}
