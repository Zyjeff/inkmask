/**
 * Browser-only fixture renderer. Spawns the static server, drives Edge via
 * playwright-core, writes PNGs into fixtures/ for visual review.
 *
 * Ink-on-transparent paper: paper pixels have alpha 0 so the photograph shows
 * through between marks. Each fixture reports gated % and changed %; for every
 * transparent-paper fixture, changed must be strictly less than gated.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "fixtures");
const PORT = Number(process.env.PORT) || 5199;
const ORIGIN = `http://localhost:${PORT}`;

const EAGLE_MASK = { source: "luminance", low: 0, high: 0.15, softness: 0.06 };
const PORTRAIT_MASK = { source: "luminance", low: 0.05, high: 0.25, softness: 0.05 };

/** Old fixture filenames to remove so fixtures/ holds only the nine below + src/. */
const OBSOLETE = [
  "contrast-dither.png",
  "eagle-ascii.png",
  "eagle-dither.png",
  "portrait-dither.png",
  "portrait-halftone.png",
  "portrait-band-sweep.png",
];

const FIXTURES = [
  {
    file: "eagle-original.png",
    source: "eagle",
    passthrough: true,
  },
  {
    file: "eagle-ascii-white.png",
    source: "eagle",
    options: {
      effect: { kind: "ascii", cellWidth: 7, cellHeight: 10 },
      mask: EAGLE_MASK,
      foreground: "#ffffff",
      blend: "screen",
    },
  },
  {
    file: "eagle-ascii-black.png",
    source: "eagle",
    options: {
      effect: { kind: "ascii", cellWidth: 7, cellHeight: 10 },
      mask: EAGLE_MASK,
      foreground: "#111111",
      blend: "normal",
      opacity: 0.85,
    },
  },
  {
    file: "eagle-dither-source.png",
    source: "eagle",
    options: {
      effect: { kind: "dither", matrix: "blueNoise", color: "source" },
      mask: EAGLE_MASK,
      blend: "normal",
    },
  },
  {
    file: "eagle-unmasked-comparison.png",
    source: "eagle",
    opaque: true,
    options: {
      effect: { kind: "dither", matrix: "blueNoise" },
      mask: { low: 0, high: 1, softness: 0 },
      background: "#ffffff",
    },
  },
  {
    file: "portrait-halftone-screen.png",
    source: "portrait",
    options: {
      effect: { kind: "halftone", cell: 6, angle: 45 },
      mask: PORTRAIT_MASK,
      foreground: "#ffffff",
      blend: "screen",
    },
  },
  {
    file: "portrait-dither-overlay.png",
    source: "portrait",
    options: {
      effect: { kind: "dither", matrix: "bayer8", scale: 2 },
      mask: PORTRAIT_MASK,
      foreground: "#ffffff",
      blend: "overlay",
    },
  },
  {
    file: "gradient-dither.png",
    source: "gradient",
    options: {
      effect: { kind: "dither", matrix: "bayer8" },
      mask: { low: 0, high: 0.35, softness: 0.3 },
      foreground: "#000000",
    },
  },
  {
    file: "blob-halftone.png",
    source: "blob",
    options: {
      effect: { kind: "halftone", cell: 5, angle: 15 },
      mask: { low: 0, high: 0.2, softness: 0.12 },
      foreground: "#000000",
    },
  },
];

function spawnServer() {
  return spawn(process.execPath, [path.join(ROOT, "scripts", "serve.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
}

async function waitForServer(ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(ORIGIN + "/");
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server on ${ORIGIN} did not become ready in ${ms}ms`);
}

function killServer(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try { child.kill(); } catch { /* already dead */ }
}

/**
 * Browser-side: load/generate source, downscale longest edge ≤ 1200, call
 * applyInkmask / passthrough, return PNG data URL + timing + gated/changed %.
 */
async function renderInPage(fixture) {
  const { render, applyInkmask, computeGate, toPixels } = await import("/dist/index.js");

  const MAX_EDGE = 1200;

  async function loadImage(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  /** Draw into an intermediate canvas so the longest edge is at most MAX_EDGE. */
  function downscale(source) {
    let w;
    let h;
    if (source instanceof HTMLImageElement) {
      w = source.naturalWidth || source.width;
      h = source.naturalHeight || source.height;
    } else {
      w = source.width;
      h = source.height;
    }
    const longest = Math.max(w, h);
    if (longest <= MAX_EDGE) {
      if (source instanceof HTMLCanvasElement) return source;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(source, 0, 0);
      return c;
    }
    const scale = MAX_EDGE / longest;
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    const c = document.createElement("canvas");
    c.width = dw;
    c.height = dh;
    c.getContext("2d").drawImage(source, 0, 0, dw, dh);
    return c;
  }

  function makeGradient() {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 600;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 900, 0);
    g.addColorStop(0, "#000000");
    g.addColorStop(1, "#ffffff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 900, 600);
    return c;
  }

  /** Soft radial gradient blob — dark center fading to a light field. */
  function makeBlob() {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 600;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, 900, 600);
    const g = ctx.createRadialGradient(450, 300, 0, 450, 300, 320);
    g.addColorStop(0, "#0a0a0a");
    g.addColorStop(0.45, "#505050");
    g.addColorStop(0.75, "#b0b0b0");
    g.addColorStop(1, "#e8e8e8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 900, 600);
    return c;
  }

  async function resolveSource(kind) {
    if (kind === "eagle") return downscale(await loadImage("/fixtures/src/eagle.jpg"));
    if (kind === "portrait") return downscale(await loadImage("/fixtures/src/portrait.jpg"));
    if (kind === "gradient") return makeGradient();
    if (kind === "blob") return makeBlob();
    throw new Error("unknown source: " + kind);
  }

  function gatedPercent(pixels, options) {
    const { gate } = computeGate(pixels, options);
    let on = 0;
    for (let i = 0; i < gate.length; i++) if (gate[i] !== 0) on++;
    return (on / gate.length) * 100;
  }

  /** Share of pixels whose RGB differs from the source after applyInkmask. */
  function changedPercent(srcPixels, resultPixels) {
    const n = srcPixels.width * srcPixels.height;
    let changed = 0;
    const a = srcPixels.data;
    const b = resultPixels.data;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]) {
        changed++;
      }
    }
    return (changed / n) * 100;
  }

  function canvasFromPixels(pixels) {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(pixels.width, pixels.height);
    imageData.data.set(pixels.data);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  const src = await resolveSource(fixture.source);

  // Reference: write the downscaled source through unmodified.
  if (fixture.passthrough) {
    let out = src;
    if (!(src instanceof HTMLCanvasElement)) {
      out = document.createElement("canvas");
      out.width = src.width;
      out.height = src.height;
      out.getContext("2d").drawImage(src, 0, 0);
    }
    return {
      dataUrl: out.toDataURL("image/png"),
      ms: 0,
      width: out.width,
      height: out.height,
      passthrough: true,
    };
  }

  const srcPixels = toPixels(src);
  const t0 = performance.now();
  const { pixels } = applyInkmask(srcPixels, fixture.options);
  const ms = performance.now() - t0;
  const gated = gatedPercent(srcPixels, fixture.options);
  const changed = changedPercent(srcPixels, pixels);
  const canvas = canvasFromPixels(pixels);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    ms,
    width: canvas.width,
    height: canvas.height,
    gated,
    changed,
  };
}

/** Luminance vs gradient mask-source cost on the 900×600 gradient. */
async function maskSourceTiming() {
  const { render } = await import("/dist/index.js");
  const c = document.createElement("canvas");
  c.width = 900;
  c.height = 600;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 900, 0);
  g.addColorStop(0, "#000000");
  g.addColorStop(1, "#ffffff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 900, 600);
  const effect = { kind: "dither", matrix: "bayer8" };
  const base = { low: 0, high: 0.5, softness: 0.3 };

  let t0 = performance.now();
  render(c, { effect, mask: { ...base, source: "luminance" } });
  const lumMs = performance.now() - t0;

  t0 = performance.now();
  render(c, { effect, mask: { ...base, source: "gradient" } });
  const gradMs = performance.now() - t0;

  return { lumMs, gradMs };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of OBSOLETE) {
    const p = path.join(OUT, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const server = spawnServer();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage();
    await page.goto(ORIGIN + "/examples/index.html", { waitUntil: "domcontentloaded" });

    let totalBytes = 0;
    let totalMs = 0;
    const transparentResults = [];

    for (const fixture of FIXTURES) {
      const result = await page.evaluate(renderInPage, fixture);
      const buf = Buffer.from(result.dataUrl.split(",", 2)[1], "base64");
      fs.writeFileSync(path.join(OUT, fixture.file), buf);

      if (result.passthrough) {
        console.log(
          `${fixture.file}  ${result.width}x${result.height}  ${(buf.length / 1024).toFixed(1)} KB  (reference source)`,
        );
      } else {
        console.log(
          `${fixture.file}  ${result.width}x${result.height}  ${result.ms.toFixed(1)}ms  ${(buf.length / 1024).toFixed(1)} KB  gated ${result.gated.toFixed(1)}%  changed ${result.changed.toFixed(1)}%`,
        );
        if (!fixture.opaque) {
          transparentResults.push({
            file: fixture.file,
            gated: result.gated,
            changed: result.changed,
          });
        }
      }
      totalBytes += buf.length;
      totalMs += result.ms;
    }
    console.log(
      `total  ${FIXTURES.length} fixtures  ${totalMs.toFixed(1)}ms  ${(totalBytes / 1024).toFixed(1)} KB`,
    );

    let failed = false;
    for (const r of transparentResults) {
      if (r.changed >= r.gated) {
        console.error(
          `FAILURE: ${r.file} replaced the whole gated region instead of marking it`,
        );
        failed = true;
      }
    }
    if (failed) {
      process.exitCode = 1;
    } else {
      console.log("OK: every transparent-paper fixture has changed < gated");
    }

    const timing = await page.evaluate(maskSourceTiming);
    console.log(
      `mask-source timing (900x600 gradient): luminance ${timing.lumMs.toFixed(1)}ms  gradient ${timing.gradMs.toFixed(1)}ms`,
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    killServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
