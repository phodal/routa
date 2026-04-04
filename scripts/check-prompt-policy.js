#!/usr/bin/env node

import fs from "node:fs";

import {
  evaluatePromptPolicyGuard,
  formatHookBlockOutput,
} from "./lib/agent-hook-policy.js";

const input = fs.readFileSync(0, "utf8");
const decision = evaluatePromptPolicyGuard(input, process.env);

if (decision) {
  process.stdout.write(`${formatHookBlockOutput(decision.reason)}\n`);
}
