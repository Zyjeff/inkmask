# inkmask progress

## Done

- **Phase 1** scaffold — package skeleton, type contract (`src/types.ts`), toolchain verified.
- **Phase 2** core engine — `color`, `matrix` + generated blue noise, `composite`, `mask`, `dither`, `index`. 59 tests passing.

## Next

- **Phase 3** — halftone, ASCII, React wrapper, then wire the new effects into `applyInkmask`'s dispatch.
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

## Open items

- The blue-noise 1024-point margin is thin (1.580 vs a 1.5 floor). The kernel was narrowed to `exp(-r²/σ²)` in response to that check failing at 1.45, so it was tuned against the metric being measured. Real acceptance is visual — judge it on the Phase 4 fixtures.
- `sobelMagnitude` in `src/mask.ts` allocates a closure per pixel for its clamped sampler. Possibly irrelevant, possibly seconds on a 4 MP photo. Measure during Phase 4 fixture rendering before optimizing.
- `resolveEffect` in `src/index.ts` returns halftone/ascii input uncast and undefaulted, relying on the dispatch throwing. Phase 3 must give those two kinds real default merging.
