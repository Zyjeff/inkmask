/** A raw RGBA pixel buffer. The only image representation the core uses. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** An 8-bit RGB triple, 0-255 per channel. */
export type RGB = [number, number, number];

/** Ordered-dither threshold matrices. Used both by effects and by the mask gate. */
export type MatrixKind = "bayer2" | "bayer4" | "bayer8" | "blueNoise";

/** Which property of the source image the mask is derived from. */
export type MaskSourceKind = "luminance" | "saturation" | "gradient" | "external";

export type BlendMode = "normal" | "multiply" | "screen" | "overlay";

/** `mono` draws the effect in two flat colors; `source` keeps the source colors. */
export type ColorMode = "mono" | "source";

/**
 * Fully resolved mask options. Always computed from the UNDITHERED source.
 * `dither` is the matrix used to threshold the mask coverage; it is deliberately
 * independent of the effect matrix so switching effects cannot change the mask.
 */
export interface MaskOptions {
  source: MaskSourceKind;
  /** Lower edge of the accepted band, 0-1, in the mask source own units. */
  low: number;
  /** Upper edge of the accepted band, 0-1. */
  high: number;
  /** Width of the linear ramp at each band edge, 0-1, in VALUE units, not pixels. */
  softness: number;
  invert: boolean;
  dither: MatrixKind;
  /** Required when `source` is "external". Its luminance becomes the coverage. */
  external?: Pixels;
}

export interface DitherEffect {
  kind: "dither";
  matrix: MatrixKind;
  /** Number of output levels per channel, >= 2. */
  levels: number;
  /** Integer >= 1. Scales the matrix up so one cell covers `scale` pixels. */
  scale: number;
  color: ColorMode;
}

export interface HalftoneEffect {
  kind: "halftone";
  /** Cell size in pixels, >= 2. */
  cell: number;
  /** Screen angle in degrees. */
  angle: number;
  shape: "circle" | "square";
  color: ColorMode;
}

export interface AsciiEffect {
  kind: "ascii";
  cellWidth: number;
  cellHeight: number;
  /** Glyphs ordered darkest to lightest. */
  ramp: string;
  /** A CSS font shorthand, e.g. "12px monospace". */
  font: string;
  color: ColorMode;
}

export type EffectOptions = DitherEffect | HalftoneEffect | AsciiEffect;

export type EffectInput =
  | ({ kind: "dither" } & Partial<Omit<DitherEffect, "kind">>)
  | ({ kind: "halftone" } & Partial<Omit<HalftoneEffect, "kind">>)
  | ({ kind: "ascii" } & Partial<Omit<AsciiEffect, "kind">>);

export interface InkmaskOptions {
  mask?: Partial<MaskOptions>;
  effect?: EffectInput;
  blend?: BlendMode;
  /** 0-1, applied after the binary mask gate. */
  opacity?: number;
  /** Hex color, e.g. "#000000". Used by `mono` effects. */
  foreground?: string;
  background?: string;
}

export interface InkmaskResult {
  pixels: Pixels;
  /** Continuous mask coverage, 0-1, length width*height, BEFORE thresholding. */
  coverage: Float32Array;
  /** The thresholded mask. Contains only 0 and 1. Length width*height. */
  gate: Uint8Array;
}
