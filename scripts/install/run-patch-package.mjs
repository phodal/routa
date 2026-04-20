import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

function resolvePatchPackageBin() {
  try {
    const pkgPath = require.resolve("patch-package/package.json");
    const pkg = require(pkgPath);
    return require.resolve(`patch-package/${pkg.bin["patch-package"]}`);
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
