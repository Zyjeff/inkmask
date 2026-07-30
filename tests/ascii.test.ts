import { describe, it, expect } from "vitest";
import { asciiGrid } from "../src/ascii.js";
import { resolveMaskToCells } from "../src/mask.js";
import type { AsciiEffect, Pixels, RGB } from "../src/types.js";

// asciiEffect needs a real canvas/font and is not called from any test in this
// Node suite. Its transparency behavior (glyphs on transparent when bg is null)
// is verified specifically in the browser harness.

function pixels(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number?],
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

function solid(width: number, height: number, r: number, g: number, b: number): Pixels {
  return pixels(width, height, () => [r, g, b]);
}

function asciiOpts(overrides: Partial<AsciiEffect> = {}): AsciiEffect {
  return {
    kind: "ascii",
    cellWidth: 4,
    cellHeight: 3,
    ramp: " .:-=+*#%@",
    font: "12px monospace",
    color: "mono",
    ...overrides,
  };
}

describe("asciiGrid", () => {
  // Correctness requirement 4 — grid dimensions use ceil so partial edge cells count.
  it("correctness req 4: 10x7 image with cell 4x3 yields cols=3 rows=3 (ceil partial edges)", () => {
    const src = solid(10, 7, 128, 128, 128);
    const grid = asciiGrid(src, asciiOpts({ cellWidth: 4, cellHeight: 3 }));
    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(3);
    expect(grid.chars.length).toBe(9);
    expect(grid.colors.length).toBe(9);
  });

  it("grid geometry matches resolveMaskToCells for awkward sizes (ASCII masking edge agreement)", () => {
    const cases: Array<{ w: number; h: number; cw: number; ch: number }> = [
      { w: 10, h: 7, cw: 4, ch: 3 },
      { w: 16, h: 16, cw: 5, ch: 5 },
      { w: 3, h: 3, cw: 8, ch: 8 },
    ];
    for (const { w, h, cw, ch } of cases) {
      const src = solid(w, h, 100, 100, 100);
      const coverage = new Float32Array(w * h);
      const mask = resolveMaskToCells(coverage, w, h, cw, ch);
      const grid = asciiGrid(src, asciiOpts({ cellWidth: cw, cellHeight: ch }));
      expect(grid.cols).toBe(mask.cols);
      expect(grid.rows).toBe(mask.rows);
    }
  });

  it("all-black yields every cell ramp[0]; all-white yields every cell last glyph", () => {
    const ramp = " .:-=+*#%@";
    const opts = asciiOpts({ ramp, cellWidth: 2, cellHeight: 2 });
    const black = asciiGrid(solid(4, 4, 0, 0, 0), opts);
    const white = asciiGrid(solid(4, 4, 255, 255, 255), opts);
    for (const c of black.chars) expect(c).toBe(ramp[0]);
    for (const c of white.chars) expect(c).toBe(ramp[ramp.length - 1]);
  });

  // Pins the contract asciiGrid shares with the renderer: ramp[0] = dark,
  // last glyph = light. asciiEffect draws these glyphs onto a transparent
  // canvas when bg is null, so the photograph shows through between and
  // inside characters.
  it("ramp orientation is unambiguous: dark cell → ramp[0], light cell → last glyph", () => {
    const ramp = " .:-=+*#%@";
    const opts = asciiOpts({ ramp, cellWidth: 2, cellHeight: 2 });
    const dark = asciiGrid(solid(2, 2, 0, 0, 0), opts);
    const light = asciiGrid(solid(2, 2, 255, 255, 255), opts);
    expect(dark.chars[0]).toBe(ramp[0]);
    expect(light.chars[0]).toBe(ramp[ramp.length - 1]);
  });

  it("is deterministic: two calls on the same input return identical chars", () => {
    const src = pixels(8, 6, (x, y) => {
      const v = (x * 30 + y * 40) % 256;
      return [v, v, v];
    });
    const opts = asciiOpts({ cellWidth: 3, cellHeight: 2 });
    const a = asciiGrid(src, opts);
    const b = asciiGrid(src, opts);
    expect(a.chars).toEqual(b.chars);
    expect(a.colors).toEqual(b.colors);
  });

  it("monotonic tone: luminance increasing left-to-right yields non-decreasing glyph indices along a row", () => {
    const ramp = " .:-=+*#%@";
    const w = 20;
    const h = 4;
    // Gray ramp left → right so cell mean luminance is non-decreasing.
    const src = pixels(w, h, (x) => {
      const v = Math.round((x / (w - 1)) * 255);
      return [v, v, v];
    });
    const grid = asciiGrid(src, asciiOpts({ ramp, cellWidth: 4, cellHeight: 4 }));
    const row0 = grid.chars.slice(0, grid.cols);
    const indices = row0.map((ch) => ramp.indexOf(ch));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!);
    }
  });

  it("partial edge cells average only their clipped region (rightmost cell ignores left columns)", () => {
    // 10 wide, cellWidth 4 → cols 3; last cell covers x=8,9 only.
    // Left 8 columns pure red; last 2 columns pure blue.
    const src = pixels(10, 3, (x) => (x >= 8 ? [0, 0, 255] : [255, 0, 0]));
    const grid = asciiGrid(src, asciiOpts({ cellWidth: 4, cellHeight: 3 }));
    expect(grid.cols).toBe(3);
    // Rightmost cell of row 0 (index 2): only blue pixels.
    expect(grid.colors[2]).toEqual([0, 0, 255]);
    // First cell: only red.
    expect(grid.colors[0]).toEqual([255, 0, 0]);
  });

  it("mean color per cell is correct on a small hand-built image", () => {
    // 2x2 image, cell 2x2 → single cell averaging all four pixels.
    // Pixels: (0,0)=(10,20,30), (1,0)=(30,40,50), (0,1)=(50,60,70), (1,1)=(70,80,90)
    // Means: R=(10+30+50+70)/4=40, G=(20+40+60+80)/4=50, B=(30+50+70+90)/4=60
    const src = pixels(2, 2, (x, y) => {
      const base = (y * 2 + x) * 20 + 10;
      return [base, base + 10, base + 20];
    });
    const grid = asciiGrid(src, asciiOpts({ cellWidth: 2, cellHeight: 2 }));
    expect(grid.cols).toBe(1);
    expect(grid.rows).toBe(1);
    expect(grid.colors[0]).toEqual([40, 50, 60]);
  });
});
