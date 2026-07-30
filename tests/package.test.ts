import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("package artifact", { timeout: 120_000 }, () => {
  it("the tarball ships dist and nothing else", () => {
    execSync("npm run build", { cwd: root, stdio: "pipe" });
    const out = execSync("npm pack --dry-run --json", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const packed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    const paths = packed[0].files.map((f) => f.path);

    const allowedRoots = new Set([
      "package.json",
      "README.md",
      "LICENSE",
      "LICENSE.md",
    ]);
    for (const p of paths) {
      const ok = p.startsWith("dist/") || allowedRoots.has(p);
      expect(ok, `unexpected pack entry: ${p}`).toBe(true);
    }

    const forbidden = ["src/", "tests/", "examples/", "fixtures/", "scripts/"];
    for (const p of paths) {
      for (const prefix of forbidden) {
        expect(p.startsWith(prefix), `must not ship ${p}`).toBe(false);
      }
    }
  });

  it("both entry points resolve", () => {
    const required = [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/react.js",
      "dist/react.d.ts",
    ];
    for (const rel of required) {
      expect(existsSync(join(root, rel)), `missing ${rel}`).toBe(true);
    }

    const pkg = readJson(join(root, "package.json")) as {
      exports: Record<string, string | { types?: string; import?: string }>;
    };
    for (const [key, value] of Object.entries(pkg.exports)) {
      if (typeof value === "string") {
        const abs = join(root, value.replace(/^\.\//, ""));
        expect(existsSync(abs), `exports["${key}"] -> ${value}`).toBe(true);
      } else {
        for (const [cond, path] of Object.entries(value)) {
          if (typeof path !== "string") continue;
          const abs = join(root, path.replace(/^\.\//, ""));
          expect(
            existsSync(abs),
            `exports["${key}"].${cond} -> ${path}`,
          ).toBe(true);
        }
      }
    }
  });

  it("the package stays side-effect free and dependency free", () => {
    const pkg = readJson(join(root, "package.json")) as {
      sideEffects: unknown;
      type: string;
      files: string[];
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(pkg.sideEffects).toBe(false);
    expect(pkg.type).toBe("module");
    expect(pkg.files).toEqual(["dist"]);

    const deps = pkg.dependencies;
    expect(
      deps === undefined || Object.keys(deps).length === 0,
      "dependencies must be absent or empty",
    ).toBe(true);

    expect(pkg.peerDependencies).toBeDefined();
    expect(pkg.peerDependencies).toHaveProperty("react");
    if (deps) {
      expect(deps).not.toHaveProperty("react");
    }
  });

  it("the registry item matches the source", () => {
    const registry = readJson(join(root, "registry.json")) as {
      files: Array<{ path: string; content: string }>;
    };

    for (const entry of registry.files) {
      // path is like "inkmask/types.ts" -> src/types.ts
      const name = entry.path.replace(/^inkmask\//, "");
      const srcPath = join(root, "src", name);
      const disk = readFileSync(srcPath, "utf8");
      expect(entry.content, `registry content drift for ${name}`).toBe(disk);
    }
  });

  it("the registry item is not a second implementation", () => {
    const registry = readJson(join(root, "registry.json")) as {
      files: Array<{ path: string }>;
    };
    const registered = new Set(
      registry.files.map((f) => f.path.replace(/^inkmask\//, "")),
    );

    const srcFiles = readdirSync(join(root, "src")).filter(
      (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
    );
    for (const name of srcFiles) {
      expect(
        registered.has(name),
        `src/${name} missing from registry.json`,
      ).toBe(true);
    }
  });
});
