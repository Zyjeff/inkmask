import type {
  BlendMode,
  DitherEffect,
  EffectInput,
  EffectOptions,
  InkmaskOptions,
  InkmaskResult,
  MaskOptions,
  Pixels,
} from "./types.js";
import { computeCoverage, thresholdCoverage } from "./mask.js";
import { ditherEffect } from "./dither.js";
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
  mask: {
    source: "luminance",
    low: 0,
    high: 0.5,
    softness: 0.15,
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
    return {
      kind: "dither",
      matrix: p?.matrix ?? DEFAULTS.effect.matrix,
      levels: p?.levels ?? DEFAULTS.effect.levels,
      scale: p?.scale ?? DEFAULTS.effect.scale,
      color: p?.color ?? DEFAULTS.effect.color,
    };
  }
  // Halftone / ascii: pass through partial fields; dispatch throws until implemented.
  return input as EffectOptions;
}

/** The whole pipeline as a pure function. No DOM. */
export function applyInkmask(src: Pixels, options?: InkmaskOptions): InkmaskResult {
  const mask = resolveMask(options?.mask);
  const effect = resolveEffect(options?.effect);
  const blend = options?.blend ?? DEFAULTS.blend;
  const opacity = options?.opacity ?? DEFAULTS.opacity;
  const foreground = options?.foreground ?? DEFAULTS.foreground;
  const background = options?.background ?? DEFAULTS.background;

  // 1) Coverage from the UNDITHERED source — never from the effect layer.
  const coverage = computeCoverage(src, mask);

  // Two bindings so each dispatch switch keeps a full three-way seam; switching
  // the same const twice lets TS narrow it to "dither" after the throw cases.
  const effectKind: EffectOptions["kind"] = effect.kind;
  const gateKind: EffectOptions["kind"] = effect.kind;

  // 2) Effect layer. Halftone and ascii are seams for a later unit.
  let effectLayer: Pixels;
  switch (effectKind) {
    case "dither":
      effectLayer = ditherEffect(
        src,
        effect as DitherEffect,
        parseHex(foreground),
        parseHex(background),
      );
      break;
    case "halftone":
      throw new Error('Effect "halftone" is not implemented yet');
    case "ascii":
      throw new Error('Effect "ascii" is not implemented yet');
  }

  // 3) Binary gate. Dither/halftone share per-pixel thresholding; ascii will
  //    use thresholdCoverageByCell (one-case addition) when that effect lands.
  let gate: Uint8Array;
  switch (gateKind) {
    case "dither":
    case "halftone":
      gate = thresholdCoverage(coverage, src.width, src.height, mask.dither);
      break;
    case "ascii":
      throw new Error('Effect "ascii" is not implemented yet');
  }

  // 4) Composite effect over base, gated by the mask.
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
