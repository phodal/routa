#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const outputDir = path.join(rootDir, "docs-site");

const localDocusaurus = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "docusaurus.cmd" : "docusaurus",
);
const [command, args] = fs.existsSync(localDocusaurus)
  ? [localDocusaurus, ["build", "--out-dir", outputDir]]
  : ["npx", ["docusaurus", "build", "--out-dir", outputDir]];

const result = spawnSync(command, args, {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.error) {
  console.error("Failed to run docusaurus build:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
