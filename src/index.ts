import type {
  AsciiEffect,
  BlendMode,
  DitherEffect,
  EffectInput,
  EffectOptions,
  HalftoneEffect,
  InkmaskOptions,
  InkmaskResult,
  MaskOptions,
  Pixels,
} from "./types.js";
import {
  computeCoverage,
  thresholdCoverage,
  thresholdCoverageByCell,
} from "./mask.js";
import { ditherEffect } from "./dither.js";
import { halftoneEffect } from "./halftone.js";
import { asciiEffect } from "./ascii.js";
import { composite } from "./composite.js";
import { parseHex } from "./color.js";

export type * from "./types.js";
export {
  computeCoverage,
  resolveMaskToCells,
  thresholdCoverage,
  thresholdCoverageByCell,
} from "./mask.js";
export { ditherEffect } from "./dither.js";
export { halftoneEffect } from "./halftone.js";
export { asciiEffect, asciiGrid } from "./ascii.js";
export type { AsciiGrid } from "./ascii.js";
export { blendRGB, composite } from "./composite.js";
export { relativeLuminance, saturation, srgbToLinear, parseHex } from "./color.js";

/** Defaults applied to any option left unset. */
export const DEFAULTS: {
  mask: MaskOptions;
  effect: DitherEffect;
  blend: BlendMode;
  opacity: number;
  foreground: string;
  background: string;
} = {
  // Thresholds are linear-light luminance. sRGB mid-gray (128) is linear
  // ~0.216, not 0.5; a band reaching high: 0.5 would gate the whole frame.
  mask: {
    source: "luminance",
    low: 0,
    high: 0.15,
    softness: 0.06,
    invert: false,
    dither: "bayer8",
  },
  effect: {
    kind: "dither",
    matrix: "bayer4",
    levels: 2,
    scale: 1,
    color: "mono",
  },
  blend: "normal",
  opacity: 1,
  foreground: "#000000",
  background: "#ffffff",
};

/** Per-kind effect defaults. DEFAULTS.effect remains the dither default. */
export const EFFECT_DEFAULTS: {
  dither: DitherEffect;
  halftone: HalftoneEffect;
  ascii: AsciiEffect;
} = {
  dither: {
    kind: "dither",
    matrix: "bayer4",
    levels: 2,
    scale: 1,
    color: "mono",
  },
  halftone: {
    kind: "halftone",
    cell: 6,
    angle: 45,
    shape: "circle",
    color: "mono",
  },
  ascii: {
    kind: "ascii",
    cellWidth: 8,
    cellHeight: 12,
    ramp: "@%#*+=-:. ",
    font: "12px monospace",
    color: "mono",
  },
};

function resolveMask(partial?: Partial<MaskOptions>): MaskOptions {
  return {
    source: partial?.source ?? DEFAULTS.mask.source,
    low: partial?.low ?? DEFAULTS.mask.low,
    high: partial?.high ?? DEFAULTS.mask.high,
    softness: partial?.softness ?? DEFAULTS.mask.softness,
    invert: partial?.invert ?? DEFAULTS.mask.invert,
    dither: partial?.dither ?? DEFAULTS.mask.dither,
    external: partial?.external ?? DEFAULTS.mask.external,
  };
}

/** Field-by-field merge; discriminate the effect union on `kind`. */
function resolveEffect(input?: EffectInput): EffectOptions {
  const kind = input?.kind ?? DEFAULTS.effect.kind;
  if (kind === "dither") {
    const p = input?.kind === "dither" ? input : undefined;
    const d = EFFECT_DEFAULTS.dither;
    return {
      kind: "dither",
      matrix: p?.matrix ?? d.matrix,
      levels: p?.levels ?? d.levels,
      scale: p?.scale ?? d.scale,
      color: p?.color ?? d.color,
    };
  }
  if (kind === "halftone") {
    const p = input?.kind === "halftone" ? input : undefined;
    const d = EFFECT_DEFAULTS.halftone;
    return {
      kind: "halftone",
      cell: p?.cell ?? d.cell,
      angle: p?.angle ?? d.angle,
      shape: p?.shape ?? d.shape,
      color: p?.color ?? d.color,
    };
  }
  // kind === "ascii"
  const p = input?.kind === "ascii" ? input : undefined;
  const d = EFFECT_DEFAULTS.ascii;
  return {
    kind: "ascii",
    cellWidth: p?.cellWidth ?? d.cellWidth,
    cellHeight: p?.cellHeight ?? d.cellHeight,
    ramp: p?.ramp ?? d.ramp,
    font: p?.font ?? d.font,
    color: p?.color ?? d.color,
  };
}

/**
 * Pure gate: coverage from the undithered source, then thresholded.
 * ASCII uses cell-resolved thresholding so no character is half-masked;
 * dither and halftone use per-pixel thresholding. Free of DOM / canvas.
 */
export function computeGate(
  src: Pixels,
  options?: InkmaskOptions,
): { coverage: Float32Array; gate: Uint8Array } {
  const mask = resolveMask(options?.mask);
  const effect = resolveEffect(options?.effect);
  const coverage = computeCoverage(src, mask);

  if (effect.kind === "ascii") {
    return {
      coverage,
      gate: thresholdCoverageByCell(
        coverage,
        src.width,
        src.height,
        effect.cellWidth,
        effect.cellHeight,
        mask.dither,
      ),
    };
  }

  return {
    coverage,
    gate: thresholdCoverage(coverage, src.width, src.height, mask.dither),
  };
}

/**
 * The whole pipeline. Coverage/gate are pure; the effect layer for kind
 * "ascii" requires a DOM (glyph rasterization via canvas). Dither and
 * halftone stay pure and run in Node under the test suite.
 */
export function applyInkmask(src: Pixels, options?: InkmaskOptions): InkmaskResult {
  const effect = resolveEffect(options?.effect);
  const blend = options?.blend ?? DEFAULTS.blend;
  const opacity = options?.opacity ?? DEFAULTS.opacity;
  const foreground = options?.foreground ?? DEFAULTS.foreground;
  const background = options?.background ?? DEFAULTS.background;

  const { coverage, gate } = computeGate(src, options);

  const fg = parseHex(foreground);
  const bg = parseHex(background);

  let effectLayer: Pixels;
  switch (effect.kind) {
    case "dither":
      effectLayer = ditherEffect(src, effect, fg, bg);
      break;
    case "halftone":
      effectLayer = halftoneEffect(src, effect, fg, bg);
      break;
    case "ascii":
      effectLayer = asciiEffect(src, effect, fg, bg);
      break;
  }

  const pixels = composite(src, effectLayer, gate, { blend, opacity });

  return { pixels, coverage, gate };
}

// ---------------------------------------------------------------------------
// Browser-only. Touch DOM / canvas. Everything above this line is pure and
// runs in Node under the test suite with no canvas polyfill.
// ---------------------------------------------------------------------------

function isPixels(source: CanvasImageSource | Pixels): source is Pixels {
  return (
    typeof source === "object" &&
    source !== null &&
    "data" in source &&
    (source as Pixels).data instanceof Uint8ClampedArray
  );
}

/** Decode any canvas-drawable source into raw pixels. Browser only. */
export function toPixels(source: CanvasImageSource): Pixels {
  let width: number;
  let height: number;
  if (source instanceof HTMLVideoElement) {
    width = source.videoWidth;
    height = source.videoHeight;
  } else if (source instanceof HTMLImageElement) {
    width = source.naturalWidth || source.width;
    height = source.naturalHeight || source.height;
  } else {
    width = (source as ImageBitmap).width;
    height = (source as ImageBitmap).height;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

/** Run the pipeline and draw the result to a new canvas. Browser only. */
export function render(
  source: CanvasImageSource | Pixels,
  options?: InkmaskOptions,
): HTMLCanvasElement {
  const src = isPixels(source) ? source : toPixels(source);
  const { pixels } = applyInkmask(src, options);
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(pixels.width, pixels.height);
  imageData.data.set(pixels.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Export a rendered canvas as a PNG blob. Browser only. */
export function toPNGBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("canvas.toBlob returned null"));
      else resolve(blob);
    }, "image/png");
  });
}
