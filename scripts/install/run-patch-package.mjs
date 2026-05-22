import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);

function resolvePatchPackageBin() {
  try {
    const pkgPath = require.resolve("patch-package/package.json");
    const pkg = require(pkgPath);
    const binEntry =
      typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["patch-package"];

    if (!binEntry) {
      return null;
    }

    return path.resolve(path.dirname(pkgPath), binEntry);
  } catch {
    return null;
  }
}

const patchPackageBin = resolvePatchPackageBin();

if (!patchPackageBin) {
  console.warn("[postinstall] patch-package not installed; skipping patch application.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [patchPackageBin], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
