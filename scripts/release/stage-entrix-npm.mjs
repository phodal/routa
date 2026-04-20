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
const version = args.version || process.env.ENTRIX_VERSION;
const artifactRoot = path.resolve(args.artifacts || "dist/entrix-artifacts");
const outputDir = path.resolve(args.out || "dist/npm");
const sourcePackage = path.resolve(args.package || "packages/entrix");
const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "entrix-npm-"));

if (!version) {
  throw new Error("--version is required");
}

const platformPackages = [
  {
    key: "darwin-arm64",
    artifact: "entrix-darwin-arm64",
    packageName: "entrix-darwin-arm64",
    os: ["darwin"],
    cpu: ["arm64"],
    binary: "entrix",
    description: "Entrix CLI binary for Apple Silicon macOS.",
  },
  {
    key: "darwin-x64",
    artifact: "entrix-darwin-x64",
    packageName: "entrix-darwin-x64",
    os: ["darwin"],
    cpu: ["x64"],
    binary: "entrix",
    description: "Entrix CLI binary for Intel macOS.",
  },
  {
    key: "linux-x64",
    artifact: "entrix-linux-x64",
    packageName: "entrix-linux-x64",
    os: ["linux"],
    cpu: ["x64"],
    binary: "entrix",
    description: "Entrix CLI binary for Linux x64.",
  },
  {
    key: "win32-x64",
    artifact: "entrix-win32-x64",  // Must match GitHub Actions matrix.key
    packageName: "entrix-windows-x64",
    os: ["win32"],
    cpu: ["x64"],
    binary: "entrix.exe",
    description: "Entrix CLI binary for Windows x64.",
  },
];

const sourceTemplate = JSON.parse(
  fs.readFileSync(path.join(sourcePackage, "package.json"), "utf8"),
);

await fsp.mkdir(outputDir, { recursive: true });

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

  const mainPackageDir = path.join(stagingRoot, "entrix");
  await fsp.mkdir(mainPackageDir, { recursive: true });
  await fsp.cp(path.join(sourcePackage, "bin"), path.join(mainPackageDir, "bin"), {
    recursive: true,
  });
  await fsp.cp(
    path.join(sourcePackage, "README.md"),
    path.join(mainPackageDir, "README.md"),
  );

  const mainPackageJson = {
    ...sourceTemplate,
    version,
    optionalDependencies: Object.fromEntries(
      platformPackages.map((p) => [p.packageName, version]),
    ),
  };

  await fsp.writeFile(
    path.join(mainPackageDir, "package.json"),
    `${JSON.stringify(mainPackageJson, null, 2)}\n`,
    "utf8",
  );

  const mainTarball = npmPack(mainPackageDir);
  await fsp.rename(
    path.join(mainPackageDir, mainTarball),
    path.join(outputDir, mainTarball),
  );

  console.log("Entrix npm packages staged successfully:");
  for (const platform of platformPackages) {
    console.log(`  - ${platform.packageName}@${version}`);
  }
  console.log(`  - entrix@${version}`);
} catch (err) {
  console.error("Stage entrix npm packages failed:", err.message);
  process.exit(1);
} finally {
  await fsp.rm(stagingRoot, { recursive: true, force: true });
}

