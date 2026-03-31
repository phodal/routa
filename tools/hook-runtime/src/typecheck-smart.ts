import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type TypecheckResult = {
  code: number;
  output: string;
};

function runTypecheck(): TypecheckResult {
  const result = spawnSync("npx", ["tsc", "--noEmit"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (output) {
    console.log(output.trimEnd());
  }

  return {
    code: result.status ?? 1,
    output,
  };
}

function runTypecheckWithSmartRetry(): number {
  const firstRun = runTypecheck();
  if (firstRun.code === 0) {
    console.log("ts_typecheck_pass: ok");
    return 0;
  }

  if (/\.next\/types\/.*Cannot find module.*src\/app\/.*page\.js/.test(firstRun.output)) {
    console.log("Detected stale .next types. Cleaning and retrying...");
    rmSync(path.join(process.cwd(), ".next"), { recursive: true, force: true });
    const secondRun = runTypecheck();
    if (secondRun.code === 0) {
      console.log("ts_typecheck_pass: ok");
      return 0;
    }
  }

  return 1;
}

export function runTypecheckSmart(): number {
  return runTypecheckWithSmartRetry();
}

const moduleBasename = path.basename(process.argv[1] ?? "");
if (moduleBasename === "typecheck-smart.ts") {
  process.exit(runTypecheckWithSmartRetry());
}

