import { useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { BlendMode, EffectInput, MaskOptions } from "./types.js";
import { applyInkmask, toPixels } from "./index.js";

export interface InkmaskProps {
  /** Image URL, or an already-decoded drawable source. */
  src: string | HTMLImageElement | ImageBitmap;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  mask?: Partial<MaskOptions>;
  effect?: EffectInput;
  blend?: BlendMode;
  opacity?: number;
  foreground?: string;
  background?: string;
  /** Called with the canvas after each successful render. */
  onRender?: (canvas: HTMLCanvasElement) => void;
  onError?: (error: unknown) => void;
}

async function resolveSrc(
  src: string | HTMLImageElement | ImageBitmap,
): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof src !== "string") return src;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  if (typeof img.decode === "function") await img.decode();
  else
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    });
  return img;
}

export function Inkmask({
  src,
  alt,
  className,
  style,
  mask,
  effect,
  blend,
  opacity,
  foreground,
  background,
  onRender,
  onError,
}: InkmaskProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Widen for field-level effect deps across the EffectInput union.
  const e = effect as Record<string, unknown> | undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const drawable = await resolveSrc(src);
        if (cancelled) return;
        const { pixels } = applyInkmask(toPixels(drawable), {
          mask,
          effect,
          blend,
          opacity,
          foreground,
          background,
        });
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = pixels.width;
        canvas.height = pixels.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const imageData = ctx.createImageData(pixels.width, pixels.height);
        imageData.data.set(pixels.data);
        ctx.putImageData(imageData, 0, 0);
        onRender?.(canvas);
      } catch (err) {
        if (!cancelled) onError?.(err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Field-level deps so inline `mask={{ low: 0.2 }}` does not re-fire every parent render.
  }, [
    src,
    mask?.source,
    mask?.low,
    mask?.high,
    mask?.softness,
    mask?.invert,
    mask?.dither,
    mask?.external,
    e?.kind,
    e?.matrix,
    e?.levels,
    e?.scale,
    e?.color,
    e?.cell,
    e?.angle,
    e?.shape,
    e?.cellWidth,
    e?.cellHeight,
    e?.ramp,
    e?.font,
    blend,
    opacity,
    foreground,
    background,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={style}
      aria-label={alt}
      role={alt !== undefined ? "img" : undefined}
    />
  );
}
