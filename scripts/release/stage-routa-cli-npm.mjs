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
const version = args.version || process.env.ROUTA_CLI_VERSION;
const artifactRoot = path.resolve(args.artifacts || "dist/cli-artifacts");
const outputDir = path.resolve(args.out || "dist/npm");
const sourcePackage = path.resolve(args.package || "packages/routa-cli");
const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-cli-npm-"));

if (!version) {
  throw new Error("--version is required");
}

const platformPackages = [
  {
    key: "darwin-arm64",
    artifact: "routa-cli-darwin-arm64",
    packageName: "routa-cli-darwin-arm64",
    os: ["darwin"],
    cpu: ["arm64"],
    binary: "routa",
    description: "Routa CLI binary for Apple Silicon macOS.",
  },
  {
    key: "darwin-x64",
    artifact: "routa-cli-darwin-x64",
    packageName: "routa-cli-darwin-x64",
    os: ["darwin"],
    cpu: ["x64"],
    binary: "routa",
    description: "Routa CLI binary for Intel macOS.",
  },
  {
    key: "linux-x64",
    artifact: "routa-cli-linux-x64",
    packageName: "routa-cli-linux-x64",
    os: ["linux"],
    cpu: ["x64"],
    binary: "routa",
    description: "Routa CLI binary for Linux x64.",
  },
  {
    key: "win32-x64",
    artifact: "routa-cli-win32-x64",
    packageName: "routa-cli-windows-x64",
    os: ["win32"],
    cpu: ["x64"],
    binary: "routa.exe",
    description: "Routa CLI binary for Windows x64.",
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
  // Stage platform-specific packages
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

  // Stage main package (routa-cli)
  const mainPackageDir = path.join(stagingRoot, "routa-cli");
  await fsp.mkdir(mainPackageDir, { recursive: true });

  // Copy files from source package
  const filesToCopy = ["bin", "README.md", "package.json"];
  for (const file of filesToCopy) {
    const sourcePath = path.join(sourcePackage, file);
    const targetPath = path.join(mainPackageDir, file);
    if (fs.existsSync(sourcePath)) {
      const stat = await fsp.stat(sourcePath);
      if (stat.isDirectory()) {
        await fsp.cp(sourcePath, targetPath, { recursive: true });
      } else {
        await fsp.cp(sourcePath, targetPath);
      }
    }
  }

  // Pack main package
  const mainTarballName = npmPack(mainPackageDir);
  await fsp.rename(
    path.join(mainPackageDir, mainTarballName),
    path.join(outputDir, mainTarballName),
  );

  console.log(`Staged npm tarballs in ${outputDir}`);
} finally {
  await fsp.rm(stagingRoot, { recursive: true, force: true });
}
