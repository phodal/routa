#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const nextEq = token.indexOf("=");
    if (nextEq > 0) {
      const key = token.slice(2, nextEq);
      args[key] = token.slice(nextEq + 1);
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

function npmPack(directory) {
  const result = spawnSync("npm", ["pack", "--ignore-scripts"], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${directory}`);
  }

  const lines = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  return lines[lines.length - 1];
}

const args = parseArgs(process.argv.slice(2));
const version = args.version || process.env.HARNESS_MONITOR_VERSION;
const artifactRoot = path.resolve(args.artifacts || "dist/harness-monitor-artifacts");
const outputDir = path.resolve(args.out || "dist/npm");
const sourcePackage = path.resolve(args.package || "packages/harness-monitor");
const stagingRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "harness-monitor-npm-"),
);

if (!version) {
  throw new Error("--version is required");
}

const platformPackages = [
  {
    key: "darwin-arm64",
    artifact: "harness-monitor-darwin-arm64",
    packageName: "harness-monitor-darwin-arm64",
    os: ["darwin"],
    cpu: ["arm64"],
    binary: "harness-monitor",
    description: "Harness Monitor binary for Apple Silicon macOS.",
  },
  {
    key: "darwin-x64",
    artifact: "harness-monitor-darwin-x64",
    packageName: "harness-monitor-darwin-x64",
    os: ["darwin"],
    cpu: ["x64"],
    binary: "harness-monitor",
    description: "Harness Monitor binary for Intel macOS.",
  },
  {
    key: "linux-x64",
    artifact: "harness-monitor-linux-x64",
    packageName: "harness-monitor-linux-x64",
    os: ["linux"],
    cpu: ["x64"],
    binary: "harness-monitor",
    description: "Harness Monitor binary for Linux x64.",
  },
  {
    key: "win32-x64",
    artifact: "harness-monitor-win32-x64",
    packageName: "harness-monitor-windows-x64",
    os: ["win32"],
    cpu: ["x64"],
    binary: "harness-monitor.exe",
    description: "Harness Monitor binary for Windows x64.",
  },
];

const sourceTemplate = JSON.parse(
  await fsp.readFile(path.join(sourcePackage, "package.json"), "utf8"),
);

await fsp.mkdir(outputDir, { recursive: true });
await fsp.mkdir(stagingRoot, { recursive: true });

if (!fs.existsSync(artifactRoot)) {
  throw new Error(`Artifact root not found: ${artifactRoot}`);
}

try {
  for (const platform of platformPackages) {
    const sourceBinaryPath = path.join(
      artifactRoot,
      platform.artifact,
      platform.binary,
    );
    if (!fs.existsSync(sourceBinaryPath)) {
      throw new Error(`Missing artifact binary: ${sourceBinaryPath}`);
    }

    const packageDir = path.join(stagingRoot, platform.packageName);
    const vendorDir = path.join(packageDir, "vendor");
    await fsp.mkdir(vendorDir, { recursive: true });

    await fsp.cp(sourceBinaryPath, path.join(vendorDir, platform.binary));
    if (!platform.binary.endsWith(".exe")) {
      await fsp.chmod(path.join(vendorDir, platform.binary), 0o755);
    }

    const platformPackageJson = {
      name: platform.packageName,
      version,
      description: platform.description,
      license: sourceTemplate.license,
      author: sourceTemplate.author,
      homepage: sourceTemplate.homepage,
      repository: sourceTemplate.repository,
      files: ["vendor"],
      os: platform.os,
      cpu: platform.cpu,
      publishConfig: {
        access: "public",
      },
    };

    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(platformPackageJson, null, 2)}\n`,
      "utf8",
    );

    const tarballName = npmPack(packageDir);
    await fsp.rename(
      path.join(packageDir, tarballName),
      path.join(outputDir, tarballName),
    );
  }

  const mainPackageDir = path.join(stagingRoot, "harness-monitor");
  await fsp.mkdir(mainPackageDir, { recursive: true });

  const filesToCopy = ["bin", "README.md", "package.json"];
  for (const file of filesToCopy) {
    const sourcePath = path.join(sourcePackage, file);
    const targetPath = path.join(mainPackageDir, file);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const stat = await fsp.stat(sourcePath);
    if (stat.isDirectory()) {
      await fsp.cp(sourcePath, targetPath, { recursive: true });
    } else {
      await fsp.cp(sourcePath, targetPath);
    }
  }

  const mainTarballName = npmPack(mainPackageDir);
  await fsp.rename(
    path.join(mainPackageDir, mainTarballName),
    path.join(outputDir, mainTarballName),
  );

  console.log(`Staged npm tarballs in ${outputDir}`);
} finally {
  await fsp.rm(stagingRoot, { recursive: true, force: true });
}
