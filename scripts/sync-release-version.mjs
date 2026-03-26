#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

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

async function updateTomlVersion(relativePath, version) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const updated = content.replace(
    /^version = ".*"$/m,
    `version = "${version}"`,
  );

  if (updated === content) {
    throw new Error(`Failed to update version in ${relativePath}`);
  }

  await fs.writeFile(absolutePath, updated, "utf8");
}

async function updateJsonVersion(relativePath, version) {
  const { data } = await readJson(relativePath);
  data.version = version;
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
await updateJsonVersion("packages/routa-cli/package.json", version);

console.log(`Synchronized release version to ${version}`);
