# inkmask progress

## Done

- **Phase 1** scaffold — package skeleton, type contract (`src/types.ts`), toolchain verified.
- **Phase 2** core engine — `color`, `matrix` + generated blue noise, `composite`, `mask`, `dither`, `index`. 59 tests passing.
- **Phase 3** effects and React — `halftone`, `ascii`, `react`, and the dispatch wiring. 78 tests passing.

## Next

- **Phase 4** — build config, registry JSON, example page, README, fixtures.

## Decisions and why

- Canvas 2D + CPU typed-array pipeline, not WebGL — the correctness requirements are exact-value assertions that GPU float precision makes flaky, and a CPU pipeline lets the whole test suite run in plain Node with no canvas or WebGL polyfill.
- `tsc` alone, no bundler — the core has zero runtime dependencies, so nothing needs bundling; this keeps ESM output directly browser-loadable.
- All relative imports carry an explicit `.js` extension — emitted ESM must resolve in a browser without a resolver.
- The mask is computed from the undithered source and never sees the effect; the mask dither matrix is a separate option from the effect matrix. This is enforced by API shape — no function in `src/mask.ts` takes an effect — so a mask that varies with the effect is unrepresentable, not merely untested.
- The mask falloff is a value-domain ramp thresholded against an ordered matrix, never a spatial blur — the gate is strictly binary. `softness` is a ramp width in *value* units, not pixels.
- `pool: "forks"` in vitest — the threads pool is broken on Node 24.
- Saturation is computed on linear RGB, for consistency with the luminance path.
- Gradient mask source uses a fixed Sobel normalization (`/ 4√2`), never a per-image max — a per-image max would make the mask jump between images.

## Measured evidence

- Blue noise (void-and-cluster, seed `0xdecafbad`): mean nearest-neighbour spacing **3.304** at 256 points (white noise ≈2.0, ideal packing ≈4.3) and **1.580** at 1024 points (random ≈1.0, ideal ≈2.15). Roughly 75% of ideal at both scales.
- Mask falloff at coverage ≈0.5: **63 transitions across 64 px** (32 on, 32 off) — the Bayer 50% checkerboard. A feathered mask would give 1.

## Resolved during Phase 4 verification

- **Defaults gated 100% of a real photo.** `mask.high` was `0.5`, chosen with sRGB intuition, but thresholds are linear-light. Measured on two photographs, `high: 0.5` gates every pixel — so `render(img)` with no options produced a fully processed frame, exactly what this library exists not to do. Retuned to `high: 0.15, softness: 0.06`. No math changed; requirement 3 was always satisfied. The test suite could never have caught this, because every test constructs its own explicit band.
- **`sobelMagnitude` per-pixel closure: not a problem.** Measured on 900x600 — luminance mask 123.8 ms, gradient mask 167.8 ms. A ~35% premium for a full Sobel pass is expected. Not optimizing.
- **Blue noise held up visually.** The thin 1024-point margin (1.580 vs 1.5) did not translate into a visible defect; `gradient-dither.png` shows a clean dot dissolve with no clumping.
- **`tsc` was never run after `tests/package.test.ts` landed** — 6 type errors sat in the tree while the suite stayed green, because vitest transpiles without typechecking. Fixed by adding `@types/node`. Any spec that adds a file must list `tsc` in its verification commands.

## Open items

- `fixtures/contrast-dither.png` demonstrates little. A uniformly dark disc on a uniformly light field has no intermediate tones, so the value-domain ramp has nothing to act on and the edge clips hard. This is correct behavior, not a defect — the dot dissolve comes from the image's own tonal gradient — but the fixture is a weak illustration. `gradient-dither.png` and `eagle-ascii.png` are where the falloff is actually visible.
- ASCII's effect layer needs canvas glyph rasterization, so `applyInkmask` with `kind: "ascii"` requires a DOM. `computeGate` was split out as a pure export precisely so requirement 4 stays testable in Node — and it is independently useful for callers who want the mask without rendering.
