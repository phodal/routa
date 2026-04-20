#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PLATFORM_PACKAGE_NAMES = {
  "darwin-arm64": "harness-monitor-darwin-arm64",
  "darwin-x64": "harness-monitor-darwin-x64",
  "linux-x64": "harness-monitor-linux-x64",
  "win32-x64": "harness-monitor-windows-x64",
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const eq = token.indexOf("=");
    if (eq > 0) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

function run(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(" ")} failed with exit code ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function resolvePlatformKey(explicit) {
  if (explicit) {
    return explicit;
  }
  return `${process.platform}-${process.arch}`;
}

function findTarball(directory, predicate) {
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".tgz"));
  const match = files.find(predicate);
  return match ? path.join(directory, match) : null;
}

const args = parseArgs(process.argv.slice(2));
const tarballDir = path.resolve(args["tarball-dir"] || "dist/npm");
const outPath = path.resolve(
  args.out || "dist/release/harness-monitor-verification.json",
);
const platformKey = resolvePlatformKey(args.platform);
const platformPackageName = PLATFORM_PACKAGE_NAMES[platformKey];

if (!platformPackageName) {
  throw new Error(`Unsupported verification platform: ${platformKey}`);
}

const mainTarball = findTarball(
  tarballDir,
  (file) =>
    file.startsWith("harness-monitor-") &&
    !file.includes("darwin") &&
    !file.includes("linux") &&
    !file.includes("windows") &&
    !file.includes("win32"),
);
const platformTarball = findTarball(
  tarballDir,
  (file) => file.startsWith(`${platformPackageName}-`),
);

if (!mainTarball) {
  throw new Error(`Unable to find harness-monitor tarball in ${tarballDir}`);
}
if (!platformTarball) {
  throw new Error(`Unable to find ${platformPackageName} tarball in ${tarballDir}`);
}

const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "harness-monitor-verify-"));
try {
  const npmCacheDir = path.join(tempRoot, ".npm-cache");
  const commandEnv = {
    ...process.env,
    NPM_CONFIG_CACHE: npmCacheDir,
  };

  await fsp.writeFile(
    path.join(tempRoot, "package.json"),
    `${JSON.stringify({ name: "harness-monitor-release-verify", private: true }, null, 2)}\n`,
    "utf8",
  );
  await fsp.mkdir(npmCacheDir, { recursive: true });

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=optional",
      "--no-package-lock",
      "--no-fund",
      "--no-audit",
      mainTarball,
      platformTarball,
    ],
    {
      cwd: tempRoot,
      env: commandEnv,
    },
  );

  const cliResult = run(
    "npx",
    ["--no-install", "harness-monitor", "--version"],
    {
      cwd: tempRoot,
      env: commandEnv,
    },
  );
  const report = {
    status: "passed",
    platform: platformKey,
    main_tarball: path.basename(mainTarball),
    platform_tarball: path.basename(platformTarball),
    version_output: cliResult.stdout.trim(),
  };

  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Harness Monitor tarball verification passed for ${platformKey}`);
} finally {
  await fsp.rm(tempRoot, { recursive: true, force: true });
}
