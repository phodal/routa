import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

function hasTsx() {
  try {
    require.resolve("tsx");
    return true;
  } catch {
    return false;
  }
}

if (!hasTsx()) {
  console.warn("[prepare] tsx not installed; skipping hook sync.");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "tools/hook-runtime/src/install.ts"],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
