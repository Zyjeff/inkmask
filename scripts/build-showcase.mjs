import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const templatePath = join(root, "showcase", "showcase.html");
const outPath = join(root, "showcase", "index.html");
const imagesDir = join(root, "showcase", "src");

const BUNDLE_MARKER = "<!--INKMASK_BUNDLE-->";
const IMAGES_MARKER = "<!--INKMASK_IMAGES-->";
const EXPECTED_JPG_COUNT = 5;

/** Built modules in dependency order (types/react omitted). */
const MODULES = [
  "color.js",
  "bluenoise-data.js",
  "matrix.js",
  "mask.js",
  "composite.js",
  "dither.js",
  "halftone.js",
  "ascii.js",
  "index.js",
];

/**
 * Strip ESM module syntax so files can share one scope when concatenated.
 * Handles multi-line import / re-export statements that tsc may emit.
 */
function stripModuleSyntax(source) {
  // Normalize to LF for stable regex matching across platforms.
  let code = source.replace(/\r\n/g, "\n");

  // Remove every import statement, including multi-line ones.
  code = code.replace(/^import\b[\s\S]*?;\s*$/gm, "");

  // Remove re-exports: export { ... } from "..."; (also possibly multi-line).
  code = code.replace(
    /^export\s*\{[\s\S]*?\}\s*from\s*["'][^"']*["']\s*;\s*$/gm,
    "",
  );

  // Remove export type / export * from lines entirely.
  code = code.replace(/^export\s+type\b.*$/gm, "");
  code = code.replace(/^export\s*\*\s*from\b.*$/gm, "");

  // Strip only the leading `export ` keyword from remaining declarations.
  code = code.replace(/^export\s+/gm, "");

  // Strip sourceMappingURL comment lines.
  code = code.replace(/^\/\/# sourceMappingURL=.*$/gm, "");

  return code;
}

if (!existsSync(templatePath)) {
  throw new Error(
    `showcase/showcase.html not found. Create the hand-authored template first, then re-run this script.`,
  );
}

const template = readFileSync(templatePath, "utf8");
if (!template.includes(BUNDLE_MARKER)) {
  throw new Error(
    `Marker ${BUNDLE_MARKER} not found in showcase/showcase.html. The template must contain exactly that placeholder.`,
  );
}
if (!template.includes(IMAGES_MARKER)) {
  throw new Error(
    `Marker ${IMAGES_MARKER} not found in showcase/showcase.html. The template must contain exactly that placeholder.`,
  );
}

if (!existsSync(imagesDir)) {
  throw new Error(
    `showcase/src/ is missing. Place the five showcase JPEGs there before building.`,
  );
}

const jpgNames = readdirSync(imagesDir).filter(
  (name) => extname(name).toLowerCase() === ".jpg",
);
if (jpgNames.length < EXPECTED_JPG_COUNT) {
  throw new Error(
    `Expected at least ${EXPECTED_JPG_COUNT} .jpg files in showcase/src/, found ${jpgNames.length}. ` +
      `Need library.jpg, eclipse.jpg, heather.jpg, sphere.jpg, chasm.jpg (do not inline .png originals).`,
  );
}

const imageMap = {};
let imagesEncodedBytes = 0;
for (const name of jpgNames) {
  const filePath = join(imagesDir, name);
  const key = basename(name, extname(name));
  const buf = readFileSync(filePath);
  const dataUri = `data:image/jpeg;base64,${buf.toString("base64")}`;
  imageMap[key] = dataUri;
  imagesEncodedBytes += Buffer.byteLength(dataUri, "utf8");
}

const imagesScript = `<script>window.__inkmaskImages = ${JSON.stringify(imageMap)};</script>`;

const parts = [];
for (const name of MODULES) {
  const filePath = join(distDir, name);
  if (!existsSync(filePath)) {
    throw new Error(
      `Expected dist/${name} is missing. Run \`npm run build\` before building the showcase.`,
    );
  }
  const raw = readFileSync(filePath, "utf8");
  const stripped = stripModuleSyntax(raw).trim();
  parts.push(`// ---- dist/${name} ----\n${stripped}`);
}

const bundleBody = parts.join("\n\n");
const expose =
  "window.inkmask = { applyInkmask, computeGate, render, toPixels, toPNGBlob, DEFAULTS, EFFECT_DEFAULTS, relativeLuminance, parseHex };";

const scriptBlock = `<script type="module">\n${bundleBody}\n\n${expose}\n</script>`;

// Images must be injected before the bundle so the page script can rely on both.
let page = template.replace(IMAGES_MARKER, imagesScript);
page = page.replace(BUNDLE_MARKER, scriptBlock);

writeFileSync(outPath, page, "utf8");

const bundleBytes = Buffer.byteLength(bundleBody, "utf8");
const pageBytes = Buffer.byteLength(page, "utf8");
const imagesKb = (imagesEncodedBytes / 1024).toFixed(1);
console.log(
  `Inlined ${Object.keys(imageMap).length} images (${imagesKb} KB encoded)`,
);
console.log(`Injected bundle: ${bundleBytes} bytes`);
console.log(`Wrote ${outPath} (${pageBytes} bytes)`);
