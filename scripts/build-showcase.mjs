import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const templatePath = join(root, "showcase", "showcase.html");
const outPath = join(root, "showcase", "index.html");

const MARKER = "<!--INKMASK_BUNDLE-->";

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
if (!template.includes(MARKER)) {
  throw new Error(
    `Marker ${MARKER} not found in showcase/showcase.html. The template must contain exactly that placeholder.`,
  );
}

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
const page = template.replace(MARKER, scriptBlock);

writeFileSync(outPath, page, "utf8");

const bundleBytes = Buffer.byteLength(bundleBody, "utf8");
const pageBytes = Buffer.byteLength(page, "utf8");
console.log(`Injected bundle: ${bundleBytes} bytes`);
console.log(`Wrote ${outPath} (${pageBytes} bytes)`);
