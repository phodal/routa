#!/usr/bin/env node

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PLATFORM_PACKAGES = {
  "darwin-arm64": "harness-monitor-darwin-arm64",
  "darwin-x64": "harness-monitor-darwin-x64",
  "linux-x64": "harness-monitor-linux-x64",
  "win32-x64": "harness-monitor-windows-x64",
};

const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const PLATFORM_PACKAGE = PLATFORM_PACKAGES[PLATFORM_KEY];

if (!PLATFORM_PACKAGE) {
  throw new Error(`Unsupported platform: ${process.platform} (${process.arch})`);
}

const BINARY_NAME =
  process.platform === "win32" ? "harness-monitor.exe" : "harness-monitor";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

function getPathFromPackage(packageName) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packageJsonPath);
    const vendorPath = path.join(packageDir, "vendor", BINARY_NAME);
    return existsSync(vendorPath) ? vendorPath : null;
  } catch {
    return null;
  }
}

function getPathFromLocalFallback() {
  const localBinaryPath = path.join(__dirname, "..", "vendor", BINARY_NAME);
  return existsSync(localBinaryPath) ? localBinaryPath : null;
}

const binaryPath =
  getPathFromPackage(PLATFORM_PACKAGE) || getPathFromLocalFallback();

if (!binaryPath) {
  throw new Error(
    `No Harness Monitor binary found for ${PLATFORM_KEY}. Reinstall with: npm install -g harness-monitor`,
  );
}

const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (child.killed) {
      return;
    }
    child.kill(signal);
  });
}

const code = await new Promise((resolve) => {
  child.on("error", (error) => {
    console.error(error);
    resolve(1);
  });

  child.on("exit", (_exitCode, signal) => {
    if (signal) {
      const signalCodes = {
        SIGHUP: 1,
        SIGINT: 2,
        SIGQUIT: 3,
        SIGKILL: 9,
        SIGTERM: 15,
        SIGSTOP: 19,
      };
      resolve(128 + (signalCodes[signal] ?? 1));
      return;
    }

    resolve(_exitCode ?? 1);
  });
});

process.exit(code);
