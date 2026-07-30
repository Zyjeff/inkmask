# inkmask progress

## Done

- Phase 1 scaffold — package skeleton, type contract (`src/types.ts`), toolchain verified.

## Next

- Phase 2 — color, matrix, composite, mask, dither, index
- Phase 3 — effects + React wrapper
- Phase 4 — build/registry/example/README/fixtures

## Decisions and why

- Canvas 2D + CPU typed-array pipeline, not WebGL — the correctness requirements are exact-value assertions that GPU float precision makes flaky, and a CPU pipeline lets the whole test suite run in plain Node with no canvas or WebGL polyfill.
- tsc alone, no bundler — the core has zero runtime dependencies, so nothing needs bundling; this keeps ESM output directly browser-loadable.
- All relative imports carry an explicit .js extension — emitted ESM must resolve in a browser without a resolver.
- The mask is computed from the undithered source and never sees the effect; the mask dither matrix is a separate option from the effect matrix.
- The mask falloff is a value-domain ramp thresholded against an ordered matrix, never a spatial blur — output alpha is strictly binary.
- pool: "forks" in vitest — the threads pool is broken on Node 24.
