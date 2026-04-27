#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..", "..");

function copyDir(source, target) {
  if (!existsSync(source)) {
    throw new Error(`Missing asset source: ${source}`);
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

copyDir(path.join(repoRoot, "out"), path.join(extensionRoot, "dist", "frontend"));
copyDir(path.join(repoRoot, "resources"), path.join(extensionRoot, "resources"));

const binName = process.platform === "win32" ? "routa.exe" : "routa";
const releaseBinary = path.join(repoRoot, "target", "release", binName);
if (existsSync(releaseBinary)) {
  const platformArch = `${process.platform}-${process.arch}`;
  const targetBinary = path.join(extensionRoot, "bin", platformArch, binName);
  mkdirSync(path.dirname(targetBinary), { recursive: true });
  cpSync(releaseBinary, targetBinary);
  console.log(`[routa-vscode] Copied ${releaseBinary} -> ${targetBinary}`);
} else {
  console.warn(`[routa-vscode] Release binary not found: ${releaseBinary}`);
}
