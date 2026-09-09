// Assembles dist/<target>/ from the shared src/ folder plus a per-browser manifest.
// Usage: node scripts/build.mjs [firefox|safari]   (no arg = both)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const targets = process.argv[2] ? [process.argv[2]] : ["firefox", "safari"];
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

for (const target of targets) {
  const manifestPath = join(root, "manifests", `manifest.${target}.json`);
  if (!existsSync(manifestPath)) {
    console.error(`Unknown target "${target}" (no ${manifestPath})`);
    process.exit(1);
  }
  const out = join(root, "dist", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "src"), out, { recursive: true });

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = pkg.version; // single source of truth for the version
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`built dist/${target} (manifest v${manifest.manifest_version}, version ${manifest.version})`);
}
