#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > 0) {
      args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
      continue;
    }

    args[key] = "true";
  }

  return args;
}

function normalizeVersion(input) {
  return input.replace(/^v/, "").trim();
}

async function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  return {
    absolutePath,
    data: JSON.parse(content),
  };
}

async function writeJson(relativePath, data) {
  const absolutePath = path.join(repoRoot, relativePath);
  await fs.writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function updateTomlVersion(relativePath, version, options = {}) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");

  let updated = content;

  // Update main version
  const versionMatch = content.match(/^version = "(.+)"$/m);
  if (!versionMatch || versionMatch[1] !== version) {
    updated = updated.replace(
      /^version = ".*"$/m,
      `version = "${version}"`,
    );
  }

  // Update workspace dependencies if specified
  if (options.updateWorkspaceDeps) {
    const crateNames = ["routa-core", "routa-rpc", "routa-scanner", "routa-server"];
    for (const crateName of crateNames) {
      // Match: routa-core = { version = "0.2.9", path = "../routa-core" }
      const depPattern = new RegExp(
        `(${crateName}\\s*=\\s*{[^}]*version\\s*=\\s*)"[^"]*"`,
        "g"
      );
      updated = updated.replace(depPattern, `$1"${version}"`);
    }
  }

  if (updated === content) {
    console.log(`${relativePath} already at version ${version}`);
    return;
  }

  await fs.writeFile(absolutePath, updated, "utf8");
  console.log(`Updated ${relativePath} to version ${version}`);
}

async function updateJsonVersion(relativePath, version, options = {}) {
  const { data } = await readJson(relativePath);

  let changed = false;

  // Update main version
  if (data.version !== version) {
    data.version = version;
    changed = true;
  }

  // Update optionalDependencies if specified
  if (options.updateOptionalDeps && data.optionalDependencies) {
    for (const dep of Object.keys(data.optionalDependencies)) {
      if (data.optionalDependencies[dep] !== version) {
        data.optionalDependencies[dep] = version;
        changed = true;
      }
    }
  }

  if (!changed) {
    console.log(`${relativePath} already at version ${version}`);
    return;
  }

  await writeJson(relativePath, data);
}

const args = parseArgs(process.argv.slice(2));
const rootPackage = await readJson("package.json");
const version = normalizeVersion(args.version || rootPackage.data.version);

if (!version) {
  throw new Error("Version is required");
}

rootPackage.data.version = version;
await writeJson("package.json", rootPackage.data);

await updateJsonVersion("apps/desktop/package.json", version);
await updateTomlVersion("apps/desktop/src-tauri/Cargo.toml", version);
await updateJsonVersion("apps/desktop/src-tauri/tauri.conf.json", version);
await updateJsonVersion("packages/routa-cli/package.json", version, {
  updateOptionalDeps: true,
});

// Update Rust crates versions (and their workspace dependencies)
await updateTomlVersion("crates/routa-core/Cargo.toml", version);
await updateTomlVersion("crates/routa-rpc/Cargo.toml", version, { updateWorkspaceDeps: true });
await updateTomlVersion("crates/routa-scanner/Cargo.toml", version);
await updateTomlVersion("crates/routa-server/Cargo.toml", version, { updateWorkspaceDeps: true });
await updateTomlVersion("crates/routa-cli/Cargo.toml", version, { updateWorkspaceDeps: true });

console.log(`Synchronized release version to ${version}`);
