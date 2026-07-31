# inkmask

A zero-runtime-dependency TypeScript library that applies dither, halftone, or ASCII to part of an image, using a mask derived from the image itself.

Every other library in this space replaces the image with a fully processed version. `inkmask` does not. It keeps the original image and lays a dithered, halftoned, or ASCII version over only part of it, so the effect lands on the subject and dissolves into the untouched regions as scattered dots rather than stopping at a hard edge.

## Install

```bash
npm install inkmask
```

React is an optional peer dependency. Install it only if you use the `inkmask/react` entry point.

## Usage

```js
import { render } from "inkmask";
const canvas = render(image, { mask: { low: 0, high: 0.5, softness: 0.2 } });
document.body.append(canvas);
```

React:

```jsx
import { Inkmask } from "inkmask/react";

<Inkmask src="/photo.jpg" mask={{ low: 0, high: 0.5, softness: 0.2 }} />
```

## How it works

1. **Base layer** — the original pixels, left untouched.
2. **Mask from the undithered source** — continuous coverage is computed from the source (luminance by default, in linear-light space), then thresholded against an ordered dither matrix into a binary gate.
3. **Effect layer** — the full image is rendered as dither, halftone, or ASCII.
4. **Gated composite** — where the gate is 1, the effect is blended over the base; where it is 0, the base is copied through byte-identically.

### Design decisions

**The mask is computed from the undithered source.** Thresholding happens on the original luminance (or saturation, gradient, or an external buffer) before any effect runs. Building the mask from already-dithered pixels makes its edge crunchy and uncontrollable. No function in the mask module accepts an effect parameter; the mask cannot depend on the effect.

**The mask threshold is dithered, not feathered.** Coverage is a per-pixel ramp in value space, pushed through an ordered dither matrix, so the falloff breaks into individual dots. There is no Gaussian or linear feather. A spatial blur would produce a soft smudge and lose the visual signature. The gate is always binary (0 or 1).

## Options

All options are optional. Unset fields take the defaults below.

### Mask (`options.mask`)

`softness` is a ramp width in **value units** (0–1 on the mask source field), not pixels. The mask's `dither` matrix is independent of the effect's matrix; switching effects cannot change the mask edge.

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `"luminance" \| "saturation" \| "gradient" \| "linear" \| "radial" \| "external"` | `"luminance"` | Property of the source used to build coverage. `"linear"` and `"radial"` are positional ramps (pixel position, not colour). |
| `low` | `number` | `0` | Lower edge of the accepted band, 0–1, in the mask source's own units. |
| `high` | `number` | `0.45` | Upper edge of the accepted band, 0–1. |
| `softness` | `number` | `0.08` | Width of the linear ramp at each band edge, 0–1, in value units (not pixels). |
| `invert` | `boolean` | `false` | Invert coverage after the band map. |
| `dither` | `"bayer2" \| "bayer4" \| "bayer8" \| "blueNoise"` | `"bayer8"` | Ordered matrix used to threshold coverage into the binary gate. Independent of the effect matrix. |
| `space` | `"linear" \| "srgb"` | `"srgb"` | Units for `low`, `high`, and `softness`. Applies to `"luminance"` and `"external"` only. |
| `angle` | `number` | `0` | Ramp direction in degrees for source `"linear"`. 0 runs left to right. |
| `centerX` | `number` | `0.5` | Ramp centre X for source `"radial"`, 0–1 of the image. |
| `centerY` | `number` | `0.5` | Ramp centre Y for source `"radial"`, 0–1 of the image. |
| `external` | `Pixels` | — | Required when `source` is `"external"`. Its luminance becomes the coverage field. |

#### Thresholds are in sRGB units by default

Mask band edges default to **sRGB units** so you can aim with the values you see in a colour picker (0–1 scale of the 0–255 channel). Luminance is still *computed* in linear light so channel weighting stays correct; only the comparison units change. Set `space: "linear"` to work in linear-light units directly.

Reference for linear mode (`space: "linear"`):

| sRGB 0-255 | linear |
| --- | --- |
| 0 | 0.000 |
| 64 | 0.051 |
| 128 | 0.216 |
| 192 | 0.528 |
| 224 | 0.745 |
| 255 | 1.000 |

In sRGB units the default band (`high: 0.45`, `softness: 0.08`) selects roughly the darker 45% of the image. In linear mode, useful bands are typically narrower and lower — a `high` around 0.1 to 0.2 is a normal starting point.

#### Dissolving across space

Sources `"linear"` and `"radial"` build coverage from the pixel's position rather than its colour. The band and softness work the same way as for luminance, but the field is a positional ramp, so marks can fade out across the frame without supplying a mask image. `angle` controls the linear ramp direction; `centerX` / `centerY` set the radial centre.

### Effect (`options.effect`)

Discriminated by `kind`. Default effect is dither. Per-kind defaults come from `EFFECT_DEFAULTS`.

#### Dither (`kind: "dither"`)

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `kind` | `"dither"` | `"dither"` | Selects the ordered-dither effect. |
| `matrix` | `"bayer2" \| "bayer4" \| "bayer8" \| "blueNoise"` | `"bayer4"` | Ordered-dither threshold matrix for the effect. Independent of `mask.dither`. |
| `levels` | `number` | `2` | Output levels per channel, ≥ 2. Used when `color` is `"source"`. |
| `scale` | `number` | `1` | Integer ≥ 1. Scales the matrix so one cell covers `scale` pixels. |
| `color` | `"mono" \| "source"` | `"mono"` | `"mono"` draws two flat colors; `"source"` keeps source colors. |

#### Halftone (`kind: "halftone"`)

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `kind` | `"halftone"` | — | Selects the halftone screen effect. |
| `cell` | `number` | `6` | Cell size in pixels, ≥ 2. |
| `angle` | `number` | `45` | Screen angle in degrees. |
| `shape` | `"circle" \| "square"` | `"circle"` | Dot shape. |
| `color` | `"mono" \| "source"` | `"mono"` | `"mono"` draws two flat colors; `"source"` keeps source colors. |
| `polarity` | `"positive" \| "negative"` | `"positive"` | Direction dot size grows: positive grows dots as tone darkens (ink on paper); negative grows them as tone brightens (light ink on a dark field). |

#### ASCII (`kind: "ascii"`)

ASCII runs through the same mask and composite path but produces terminal-style glyphs rather than print texture.

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `kind` | `"ascii"` | — | Selects the ASCII glyph effect. |
| `cellWidth` | `number` | `8` | Glyph cell width in pixels. |
| `cellHeight` | `number` | `12` | Glyph cell height in pixels. |
| `ramp` | `string` | `"@%#*+=-:. "` | Glyphs ordered darkest to lightest. |
| `font` | `string` | `"12px monospace"` | CSS font shorthand used when rasterizing glyphs. |
| `color` | `"mono" \| "source"` | `"mono"` | `"mono"` draws two flat colors; `"source"` keeps source colors. |

### Composite

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `blend` | `"normal" \| "multiply" \| "screen" \| "overlay"` | `"normal"` | Blend mode for the effect layer where the gate is 1. |
| `opacity` | `number` | `1` | 0–1, applied after the binary mask gate. |
| `foreground` | `string` | `"#000000"` | Hex color used by `mono` effects (ink). |
| `background` | `string \| null` | `null` | Transparent paper by default: the source shows through between marks. A hex value paints opaque paper. |

**Blending the marks into the image.** Because paper is transparent, `blend` and `opacity` act on the marks themselves against the photograph rather than on a solid effect rectangle. `foreground: "#ffffff"` with `blend: "screen"` lifts the marks into the highlights; `blend: "overlay"` increases local contrast around each mark. A plain `opacity` below 1 with white or black ink gives a softer overlay. With `color: "source"`, each mark is tinted with the underlying image’s own color.

## API

| Export | Signature | Notes |
| --- | --- | --- |
| `render` | `(source: CanvasImageSource \| Pixels, options?: InkmaskOptions) => HTMLCanvasElement` | Full pipeline to a new canvas. Requires DOM. |
| `applyInkmask` | `(src: Pixels, options?: InkmaskOptions) => InkmaskResult` | Full pipeline to raw pixels. Requires DOM when `effect.kind` is `"ascii"` (glyph rasterization); dither and halftone are pure. |
| `computeGate` | `(src: Pixels, options?: InkmaskOptions) => { coverage: Float32Array; gate: Uint8Array }` | Pure. Coverage and binary gate only; no effect, no DOM. |
| `toPixels` | `(source: CanvasImageSource) => Pixels` | Decode a drawable into a raw RGBA buffer. Requires DOM. |
| `toPNGBlob` | `(canvas: HTMLCanvasElement) => Promise<Blob>` | Export a canvas as PNG. Requires DOM. |
| `Inkmask` | React component (`inkmask/react`) | Renders into a `<canvas>`. Props: `src`, `mask`, `effect`, `blend`, `opacity`, `foreground`, `background`, plus `alt`, `className`, `style`, `onRender`, `onError`. |

`InkmaskResult` is `{ pixels: Pixels; coverage: Float32Array; gate: Uint8Array }`.

## Use the source instead

To vendor the same source into a project rather than depending on the package:

```bash
npx shadcn@latest add <url>
```

Point `<url>` at a published copy of this repo's `registry.json`. That installs the library files as project source, not a second implementation.

The vendored source uses explicit `./types.js`-style import specifiers (required so the published ESM resolves in a browser without a bundler). TypeScript with `moduleResolution: "Bundler"` and Next.js resolve those to the `.ts` files, but a default Vite setup may not — such consumers should install the package instead, or add a resolver alias.

## Browser only

There is no Node canvas backend. Browser (or any environment with DOM canvas) is required for `render`, `toPixels`, `toPNGBlob`, and for `applyInkmask` when the effect is ASCII. Still images only are supported in v1.

## License

MIT
