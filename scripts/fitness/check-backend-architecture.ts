#!/usr/bin/env node

import { spawn } from "node:child_process";

import { isDirectExecution } from "../lib/cli";

function hasSuiteFlag(argv: string[]): boolean {
  return argv.some((arg, index) => arg === "--suite" ? Boolean(argv[index + 1]) : arg.startsWith("--suite="));
}

function withDefaultSuite(argv: string[]): string[] {
  if (hasSuiteFlag(argv)) {
    return argv;
  }

  return [
    ...argv,
    "--suite",
    "boundaries",
  ];
}

function buildCargoArgs(argv: string[]): string[] {
  return [
    "run",
    "-q",
    "-p",
    "routa-cli",
    "--",
    "fitness",
    "arch-dsl",
    "--report",
    "backend-core-suite",
    ...withDefaultSuite(argv),
  ];
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = buildCargoArgs(argv);

  return await new Promise<number>((resolve, reject) => {
    const child = spawn("cargo", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

if (isDirectExecution(import.meta.url)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
