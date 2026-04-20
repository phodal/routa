#!/usr/bin/env node
/**
 * API Parity Checker
 *
 * Extracts route definitions from three sources and detects differences:
 *   1. api-contract.yaml  — the source of truth
 *   2. Next.js routes     — src/app/api/ filesystem convention
 *   3. Rust routes        — crates/routa-server/src/api/*.rs
 *
 * Usage:
 *   node --import tsx scripts/fitness/check-api-parity.ts
 *   node --import tsx scripts/fitness/check-api-parity.ts --json        # machine-readable output
 *   node --import tsx scripts/fitness/check-api-parity.ts --fix-hint    # show suggested fixes
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getCliArgs, isDirectExecution } from "../lib/cli";
import { fromRoot } from "../lib/paths";
import {
  listContractEndpoints,
  loadOpenApiContract,
  type RouteEndpoint,
} from "../lib/openapi-contract";

const args = getCliArgs();
const jsonMode = args.has("--json");
const fixHint = args.has("--fix-hint");

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────
interface ParityReport {
  contract: RouteEndpoint[];
  nextjs: RouteEndpoint[];
  rust: RouteEndpoint[];
  missingInNextjs: RouteEndpoint[];
  missingInRust: RouteEndpoint[];
  missingInContract: RouteEndpoint[];
  extraInNextjs: RouteEndpoint[];
  extraInRust: RouteEndpoint[];
}

// ─────────────────────────────────────────────────────────
// 1. Parse OpenAPI contract
// ─────────────────────────────────────────────────────────
function parseContract(): RouteEndpoint[] {
  try {
    return listContractEndpoints(loadOpenApiContract());
  } catch (error) {
    console.error(error instanceof Error ? `❌ ${error.message}` : `❌ ${String(error)}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────
// 2. Parse Next.js routes (filesystem convention)
// ─────────────────────────────────────────────────────────
function parseNextjsRoutes(): RouteEndpoint[] {
  const apiDir = path.join(ROOT, "src", "app", "api");
  const endpoints: RouteEndpoint[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name === "route.ts" || entry.name === "route.js") {
        const relativePath = path
          .relative(apiDir, path.dirname(fullPath))
          .replace(/\\/g, "/");
        const routePath = `/api/${relativePath}`.replace(/\/+$/, "");

        const content = fs.readFileSync(fullPath, "utf-8");

        // Detect exported HTTP methods (exclude OPTIONS/HEAD — CORS preflight, not API endpoints)
        const exportedMethods = [
          "GET", "POST", "PUT", "DELETE", "PATCH",
        ];
        for (const method of exportedMethods) {
          // Match: export async function GET, export function GET, export { GET }
          const regex = new RegExp(
            `export\\s+(async\\s+)?function\\s+${method}\\b|export\\s*\\{[^}]*\\b${method}\\b`
          );
          if (regex.test(content)) {
            endpoints.push({ method, path: routePath });
          }
        }
      }
    }
  }

  scanDir(apiDir);
  return endpoints;
}

// ─────────────────────────────────────────────────────────
// 3. Parse Rust routes (Axum routers)
// ─────────────────────────────────────────────────────────
function parseRustRoutes(): RouteEndpoint[] {
  const apiModPath = path.join(fromRoot("crates", "routa-server", "src", "api"), "mod.rs");
  if (!fs.existsSync(apiModPath)) {
    console.error("❌ Rust api/mod.rs not found");
    process.exit(1);
  }

  const apiModContent = fs.readFileSync(apiModPath, "utf-8");
  const endpoints: RouteEndpoint[] = [];

  // For each module, parse the router() function to extract routes
  const apiDir = fromRoot("crates", "routa-server", "src", "api");
  const visitedRouters = new Set<string>();
  collectNestedRustRoutes({
    apiDir,
    content: apiModContent,
    basePath: "",
    endpoints,
    visitedRouters,
  });

  // Also check for direct routes in mod.rs and lib.rs (like health_check)
  const directFiles = [apiModContent];
  const libPath = fromRoot("crates", "routa-server", "src", "lib.rs");
  if (fs.existsSync(libPath)) {
    directFiles.push(fs.readFileSync(libPath, "utf-8"));
  }
  for (const fileContent of directFiles) {
    const directCalls = extractRouteCalls(fileContent);
    for (const { subPath, handlerChain } of directCalls) {
      if (!subPath.startsWith("/api/")) continue;
      extractMethods(handlerChain).forEach((m) => {
        endpoints.push({ method: m, path: subPath });
      });
    }
  }

  return endpoints;
}

function collectNestedRustRoutes(params: {
  apiDir: string;
  content: string;
  basePath: string;
  endpoints: RouteEndpoint[];
  visitedRouters: Set<string>;
}) {
  const { apiDir, content, basePath, endpoints, visitedRouters } = params;

  for (const { subPath, handlerChain } of extractRouteCalls(content)) {
    const fullPath = joinRustRoutePaths(basePath, subPath);
    extractMethods(handlerChain).forEach((method) => {
      endpoints.push({ method, path: fullPath });
    });
  }

  for (const nest of extractNestCalls(content)) {
    const moduleName = nest.modulePath.split("::").filter(Boolean).at(-1);
    if (!moduleName) continue;

    const visitKey = `${basePath}::${nest.basePath}::${nest.modulePath}::${nest.functionName}`;
    if (visitedRouters.has(visitKey)) continue;
    visitedRouters.add(visitKey);

    const nestedContent = readRustApiModuleContent(apiDir, moduleName);
    if (!nestedContent) continue;

    collectNestedRustRoutes({
      apiDir,
      content: nestedContent,
      basePath: joinRustRoutePaths(basePath, nest.basePath),
      endpoints,
      visitedRouters,
    });
  }
}

function readRustApiModuleContent(apiDir: string, moduleName: string): string {
  const moduleFile = path.join(apiDir, `${moduleName}.rs`);
  const moduleDir = path.join(apiDir, moduleName);
  const files: string[] = [];

  if (fs.existsSync(moduleFile)) {
    files.push(moduleFile);
  }
  files.push(...listRustSourceFiles(moduleDir));

  return files.map((file) => fs.readFileSync(file, "utf-8")).join("\n");
}

function extractNestCalls(
  content: string
): { basePath: string; modulePath: string; functionName: string }[] {
  // Accept both zero-arg routers (`module::router()`) and stateful routers
  // such as `module::router(state)`.
  const nestRegex = /\.nest\("([^"]+)",\s*([\w:]+)::(\w+)\([^)]*\)\)/g;
  const results: { basePath: string; modulePath: string; functionName: string }[] = [];
  let match;
  while ((match = nestRegex.exec(content)) !== null) {
    results.push({
      basePath: match[1],
      modulePath: match[2],
      functionName: match[3],
    });
  }
  return results;
}

function joinRustRoutePaths(basePath: string, subPath: string): string {
  const normalizedBase = basePath.replace(/\/+$/, "");
  const normalizedSubPath = subPath === "/" ? "" : subPath;
  return `${normalizedBase}${normalizedSubPath || ""}` || "/";
}

function listRustSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRustSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

/**
 * Extract HTTP method names (GET, POST, etc.) from an Axum handler chain string.
 * Handles: get(...), .post(...), axum::routing::delete(...)
 */
function extractMethods(handlerChain: string): string[] {
  const methods: string[] = [];
  const methodNames = ["get", "post", "put", "delete", "patch"];
  for (const m of methodNames) {
    // Match: standalone get(, .get(, ::get(
    const regex = new RegExp(`(?:^|[\\s.:])${m}\\(`, "g");
    if (regex.test(handlerChain)) {
      methods.push(m.toUpperCase());
    }
  }
  return methods;
}

/**
 * Extract .route("path", handler_chain) calls from Rust source code,
 * handling nested parentheses correctly.
 */
function extractRouteCalls(
  content: string
): { subPath: string; handlerChain: string }[] {
  const results: { subPath: string; handlerChain: string }[] = [];
  const routePrefix = ".route(";

  let idx = 0;
  while (idx < content.length) {
    const pos = content.indexOf(routePrefix, idx);
    if (pos === -1) break;

    // Move past ".route("
    let cursor = pos + routePrefix.length;

    // Skip whitespace
    while (cursor < content.length && /\s/.test(content[cursor])) cursor++;

    // Expect opening quote for path
    if (content[cursor] !== '"') {
      idx = cursor + 1;
      continue;
    }
    cursor++; // skip opening quote

    // Read until closing quote
    let subPath = "";
    while (cursor < content.length && content[cursor] !== '"') {
      subPath += content[cursor];
      cursor++;
    }
    cursor++; // skip closing quote

    // Skip comma and whitespace
    while (cursor < content.length && /[\s,]/.test(content[cursor])) cursor++;

    // Now read the handler chain until we balance the outer parenthesis
    let depth = 1; // We're inside the .route( opening paren
    const handlerStart = cursor;
    while (cursor < content.length && depth > 0) {
      if (content[cursor] === "(") depth++;
      else if (content[cursor] === ")") depth--;
      if (depth > 0) cursor++;
    }

    const handlerChain = content.slice(handlerStart, cursor);
    results.push({ subPath, handlerChain });

    idx = cursor + 1;
  }

  return results;
}

// ─────────────────────────────────────────────────────────
// Comparison logic
// ─────────────────────────────────────────────────────────
function normalizeEndpoint(e: RouteEndpoint): string {
  // Normalize path params to a generic placeholder so that naming differences
  // between backends don't cause false mismatches:
  //   - Next.js [param], [taskId], [workspaceId] → {p}
  //   - Contract / Rust {id}, {task_id}, {workspaceId} → {p}
  //   - Axum-style :id segments → {p}
  // Multi-segment params like /notes/{workspaceId}/{noteId} → /notes/{p}/{p}
  const normalizedPath = e.path
    .replace(/\[([^\]]+)\]/g, "{p}")      // Next.js [param] → {p}
    .replace(/\{[^}]+\}/g, "{p}")         // Any {param} → {p}
    .replace(/\/:[^/]+/g, "/{p}")         // Axum :param → {p}
    .replace(/\/+$/, "");                  // Remove trailing slashes
  return `${e.method} ${normalizedPath}`;
}

// Methods that are infrastructure/CORS only and should not be compared
const SKIP_METHODS = new Set(["OPTIONS", "HEAD"]);

function filterEndpoints(endpoints: RouteEndpoint[]): RouteEndpoint[] {
  return endpoints.filter((e) => !SKIP_METHODS.has(e.method.toUpperCase()));
}

function compareRoutes(
  contract: RouteEndpoint[],
  nextjs: RouteEndpoint[],
  rust: RouteEndpoint[]
): ParityReport {
  // Strip CORS/infrastructure methods before comparison
  contract = filterEndpoints(contract);
  nextjs   = filterEndpoints(nextjs);
  rust     = filterEndpoints(rust);

  const contractSet = new Set(contract.map(normalizeEndpoint));
  const nextjsSet = new Set(nextjs.map(normalizeEndpoint));
  const rustSet = new Set(rust.map(normalizeEndpoint));

  const parseKey = (key: string): RouteEndpoint => {
    const [method, ...pathParts] = key.split(" ");
    return { method, path: pathParts.join(" ") };
  };

  // Missing in Next.js = in contract but not in Next.js
  const missingInNextjs = [...contractSet]
    .filter((k) => !nextjsSet.has(k))
    .map(parseKey);

  // Missing in Rust = in contract but not in Rust
  const missingInRust = [...contractSet]
    .filter((k) => !rustSet.has(k))
    .map(parseKey);

  // Missing in contract = in either backend but not in contract
  const allBackends = new Set([...nextjsSet, ...rustSet]);
  const missingInContract = [...allBackends]
    .filter((k) => !contractSet.has(k))
    .map(parseKey);

  // Extra = in backend but not in contract
  const extraInNextjs = [...nextjsSet]
    .filter((k) => !contractSet.has(k))
    .map(parseKey);

  const extraInRust = [...rustSet]
    .filter((k) => !contractSet.has(k))
    .map(parseKey);

  return {
    contract,
    nextjs,
    rust,
    missingInNextjs,
    missingInRust,
    missingInContract,
    extraInNextjs,
    extraInRust,
  };
}

// ─────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────
function printReport(report: ParityReport) {
  const ok = "✅";
  const warn = "⚠️ ";
  const fail = "❌";

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║           Routa.js API Parity Report             ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log(`📋 Contract defines:   ${report.contract.length} endpoints`);
  console.log(`🌐 Next.js implements: ${report.nextjs.length} endpoints`);
  console.log(`🦀 Rust implements:    ${report.rust.length} endpoints`);
  console.log("");

  // Common endpoints
  const contractSet = new Set(report.contract.map(normalizeEndpoint));
  const nextjsSet = new Set(report.nextjs.map(normalizeEndpoint));
  const rustSet = new Set(report.rust.map(normalizeEndpoint));
  const bothImplement = [...contractSet].filter(
    (k) => nextjsSet.has(k) && rustSet.has(k)
  );
  console.log(`${ok} Both backends implement: ${bothImplement.length}/${report.contract.length} contract endpoints\n`);

  if (report.missingInNextjs.length > 0) {
    console.log(`${fail} Missing in Next.js (${report.missingInNextjs.length}):`);
    for (const e of report.missingInNextjs) {
      console.log(`   ${e.method.padEnd(7)} ${e.path}`);
    }
    console.log("");
  }

  if (report.missingInRust.length > 0) {
    console.log(`${fail} Missing in Rust (${report.missingInRust.length}):`);
    for (const e of report.missingInRust) {
      console.log(`   ${e.method.padEnd(7)} ${e.path}`);
    }
    console.log("");
  }

  if (report.extraInNextjs.length > 0) {
    console.log(`${warn}Extra in Next.js (not in contract) (${report.extraInNextjs.length}):`);
    for (const e of report.extraInNextjs) {
      console.log(`   ${e.method.padEnd(7)} ${e.path}`);
    }
    console.log("");
  }

  if (report.extraInRust.length > 0) {
    console.log(`${warn}Extra in Rust (not in contract) (${report.extraInRust.length}):`);
    for (const e of report.extraInRust) {
      console.log(`   ${e.method.padEnd(7)} ${e.path}`);
    }
    console.log("");
  }

  if (fixHint && (report.missingInNextjs.length > 0 || report.missingInRust.length > 0)) {
    console.log("─── Fix Hints ───────────────────────────────────\n");

    if (report.missingInNextjs.length > 0) {
      console.log("Next.js: Create these route files:");
      for (const e of report.missingInNextjs) {
        const routeDir = e.path
          .replace(/^\/api/, "src/app/api")
          .replace(/\{(\w+)\}/g, "[$1]");
        console.log(`   ${routeDir}/route.ts → export async function ${e.method}()`);
      }
      console.log("");
    }

    if (report.missingInRust.length > 0) {
      console.log("Rust: Add these handlers in crates/routa-server/src/api/:");
      for (const e of report.missingInRust) {
        console.log(`   ${e.method.padEnd(7)} ${e.path}`);
      }
      console.log("");
    }
  }

  // Summary
  // Backend-extra routes are printed above as warnings and included in the JSON
  // report, but the parity hard gate tracks contract coverage: every OpenAPI
  // endpoint must exist in both backends.
  const totalIssues =
    report.missingInNextjs.length +
    report.missingInRust.length;

  if (totalIssues === 0) {
    console.log(`${ok} All contract endpoints are implemented by both backends!\n`);
  } else {
    console.log(`── Summary: ${totalIssues} parity issue(s) found ──\n`);
  }

  return totalIssues;
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
export function buildJsonSummary(report: ParityReport) {
  return {
    summary: {
      contractEndpoints: report.contract.length,
      nextjsEndpoints: report.nextjs.length,
      rustEndpoints: report.rust.length,
      missingInNextjs: report.missingInNextjs.length,
      missingInRust: report.missingInRust.length,
      extraInNextjs: report.extraInNextjs.length,
      extraInRust: report.extraInRust.length,
    },
    missingInNextjs: report.missingInNextjs,
    missingInRust: report.missingInRust,
    extraInNextjs: report.extraInNextjs,
    extraInRust: report.extraInRust,
  };
}

function main() {
  const contract = parseContract();
  const nextjs = parseNextjsRoutes();
  const rust = parseRustRoutes();
  const report = compareRoutes(contract, nextjs, rust);

  if (jsonMode) {
    console.log(JSON.stringify(buildJsonSummary(report), null, 2));
    const totalIssues = report.missingInNextjs.length + report.missingInRust.length;
    process.exit(totalIssues > 0 ? 1 : 0);
  }

  const issues = printReport(report);
  process.exit(issues > 0 ? 1 : 0);
}

const ROOT = fromRoot();

if (isDirectExecution(import.meta.url)) {
  main();
}
