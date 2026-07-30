/**
 * Browser-only fixture renderer. Spawns the static server, drives Edge via
 * playwright-core, writes PNGs into fixtures/ for visual review.
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

const FIXTURES = [
  { file: "eagle-ascii.png", source: "eagle",
    options: { effect: { kind: "ascii", cellWidth: 7, cellHeight: 10 }, mask: EAGLE_MASK } },
  { file: "eagle-dither.png", source: "eagle",
    options: { effect: { kind: "dither", matrix: "blueNoise" }, mask: EAGLE_MASK } },
  { file: "eagle-unmasked-comparison.png", source: "eagle",
    options: { effect: { kind: "dither", matrix: "blueNoise" }, mask: { low: 0, high: 1, softness: 0 } } },
  { file: "portrait-dither.png", source: "portrait",
    options: { effect: { kind: "dither", matrix: "bayer8", scale: 2 }, mask: PORTRAIT_MASK } },
  { file: "portrait-halftone.png", source: "portrait",
    options: { effect: { kind: "halftone", cell: 6, angle: 45 }, mask: PORTRAIT_MASK } },
  { file: "gradient-dither.png", source: "gradient",
    options: { effect: { kind: "dither", matrix: "bayer8" }, mask: { low: 0, high: 0.35, softness: 0.3 } } },
  { file: "contrast-dither.png", source: "contrast",
    options: { effect: { kind: "dither", matrix: "bayer4" }, mask: { low: 0, high: 0.15, softness: 0.1 } } },
  { file: "portrait-band-sweep.png", source: "portrait", bandSweep: true },
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

/** Browser-side: load/generate source, call render(), return PNG data URL + timing + gated %. */
async function renderInPage(fixture) {
  const { render, computeGate, toPixels } = await import("/dist/index.js");

  async function loadImage(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  function makeGradient() {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 600;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 900, 0);
    g.addColorStop(0, "#000000");
    g.addColorStop(1, "#ffffff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 900, 600);
    return c;
  }

  function makeContrast() {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 600;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(450, 300, 180, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }

  async function resolveSource(kind) {
    if (kind === "eagle") return loadImage("/fixtures/src/eagle.jpg");
    if (kind === "portrait") return loadImage("/fixtures/src/portrait.jpg");
    if (kind === "gradient") return makeGradient();
    if (kind === "contrast") return makeContrast();
    throw new Error("unknown source: " + kind);
  }

  function gatedPercent(pixels, options) {
    const { gate } = computeGate(pixels, options);
    let on = 0;
    for (let i = 0; i < gate.length; i++) if (gate[i] !== 0) on++;
    return (on / gate.length) * 100;
  }

  const src = await resolveSource(fixture.source);

  if (fixture.bandSweep) {
    const highs = [0.10, 0.20, 0.35];
    const gap = 12;
    const panels = [];
    const panelGated = [];
    let totalMs = 0;
    const pixels = toPixels(src);
    for (const high of highs) {
      const opts = {
        effect: { kind: "dither", matrix: "bayer8" },
        mask: { low: 0.05, high, softness: 0.05 },
      };
      const t0 = performance.now();
      panels.push(render(src, opts));
      totalMs += performance.now() - t0;
      panelGated.push(gatedPercent(pixels, opts));
    }
    const w = panels[0].width, h = panels[0].height;
    const strip = document.createElement("canvas");
    strip.width = w * 3 + gap * 2;
    strip.height = h;
    const ctx = strip.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, strip.width, strip.height);
    panels.forEach((p, i) => ctx.drawImage(p, i * (w + gap), 0));
    return {
      dataUrl: strip.toDataURL("image/png"),
      ms: totalMs,
      width: strip.width,
      height: strip.height,
      panelGated,
    };
  }

  const t0 = performance.now();
  const canvas = render(src, fixture.options);
  const ms = performance.now() - t0;
  const gated = gatedPercent(toPixels(src), fixture.options);
  return { dataUrl: canvas.toDataURL("image/png"), ms, width: canvas.width, height: canvas.height, gated };
}

/** Luminance vs gradient mask-source cost on the 900×600 gradient. */
async function maskSourceTiming() {
  const { render } = await import("/dist/index.js");
  const c = document.createElement("canvas");
  c.width = 900; c.height = 600;
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
  const server = spawnServer();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage();
    await page.goto(ORIGIN + "/examples/index.html", { waitUntil: "domcontentloaded" });

    let totalBytes = 0, totalMs = 0;
    for (const fixture of FIXTURES) {
      const result = await page.evaluate(renderInPage, fixture);
      const buf = Buffer.from(result.dataUrl.split(",", 2)[1], "base64");
      fs.writeFileSync(path.join(OUT, fixture.file), buf);
      let gatedStr;
      if (result.panelGated) {
        gatedStr = result.panelGated
          .map((p, i) => `panel${i + 1} ${p.toFixed(1)}%`)
          .join(", ");
      } else {
        gatedStr = `gated ${result.gated.toFixed(1)}%`;
      }
      console.log(
        `${fixture.file}  ${result.width}x${result.height}  ${result.ms.toFixed(1)}ms  ${(buf.length / 1024).toFixed(1)} KB  ${gatedStr}`,
      );
      totalBytes += buf.length;
      totalMs += result.ms;
    }
    console.log(
      `total  ${FIXTURES.length} fixtures  ${totalMs.toFixed(1)}ms  ${(totalBytes / 1024).toFixed(1)} KB`,
    );

    const eagleMasked = fs.readFileSync(path.join(OUT, "eagle-dither.png"));
    const eagleUnmasked = fs.readFileSync(path.join(OUT, "eagle-unmasked-comparison.png"));
    if (eagleMasked.equals(eagleUnmasked)) {
      console.error("FAILURE: masked and unmasked eagle fixtures are identical");
      process.exitCode = 1;
    } else {
      console.log("OK: masked and unmasked eagle fixtures differ");
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
