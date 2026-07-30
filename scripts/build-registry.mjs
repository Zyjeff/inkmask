import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");

/** Source files in dependency order (react last; rest as specified). */
const SOURCES = [
  "types.ts",
  "color.ts",
  "bluenoise-data.ts",
  "matrix.ts",
  "mask.ts",
  "composite.ts",
  "dither.ts",
  "halftone.ts",
  "ascii.ts",
  "index.ts",
  "react.tsx",
];

const files = SOURCES.map((name) => {
  const content = readFileSync(join(srcDir, name), "utf8");
  return {
    path: `inkmask/${name}`,
    type: name === "react.tsx" ? "registry:ui" : "registry:lib",
    content,
  };
});

const registry = {
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "inkmask",
  type: "registry:ui",
  title: "Inkmask",
  description:
    "Apply dither, halftone, or ASCII to part of an image using a mask derived from the image itself.",
  dependencies: [],
  registryDependencies: [],
  files,
};

const outPath = join(root, "registry.json");
writeFileSync(outPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath} (${files.length} files)`);
