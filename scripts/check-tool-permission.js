#!/usr/bin/env node

import fs from "node:fs";

import {
  evaluateToolPermissionGuard,
  formatHookBlockOutput,
} from "./lib/agent-hook-policy.js";

const input = fs.readFileSync(0, "utf8");
const decision = evaluateToolPermissionGuard(input, process.env);

if (decision) {
  process.stdout.write(`${formatHookBlockOutput(decision.reason)}\n`);
}
