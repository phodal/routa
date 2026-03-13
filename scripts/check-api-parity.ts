#!/usr/bin/env npx tsx
/**
 * API Parity Checker
 *
 * Extracts route definitions from three sources and detects differences:
 *   1. api-contract.yaml  — the source of truth
 *   2. Next.js routes     — src/app/api/ filesystem convention
 *   3. Rust routes        — crates/routa-server/src/api/*.rs
 *
 * Usage:
 *   npx tsx scripts/check-api-parity.ts
 *   npx tsx scripts/check-api-parity.ts --json        # machine-readable output
 *   npx tsx scripts/check-api-parity.ts --fix-hint    # show suggested fixes
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const jsonMode = process.argv.includes("--json");
const fixHint = process.argv.includes("--fix-hint");

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────
interface RouteEndpoint {
  method: string; // GET, POST, DELETE, PATCH, PUT
  path: string;   // /api/agents, /api/agents/{id}, etc.
}

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
  const contractPath = path.join(ROOT, "api-contract.yaml");
  if (!fs.existsSync(contractPath)) {
    console.error("❌ api-contract.yaml not found at project root");
    process.exit(1);
  }

  const content = fs.readFileSync(contractPath, "utf-8");
  const endpoints: RouteEndpoint[] = [];

  // Simple YAML path parser — no dependency needed
  // Matches lines like: "  /api/agents:" and "    get:", "    post:"
  let currentPath = "";
  const methods = ["get", "post", "put", "delete", "patch", "options", "head"];

  for (const line of content.split("\n")) {
    // Match path definitions (2-space indented, starts with /)
    const pathMatch = line.match(/^ {2}(\/api\/\S+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }

    // Match method definitions (4-space indented)
    if (currentPath) {
      const methodMatch = line.match(/^ {4}(\w+):$/);
      if (methodMatch && methods.includes(methodMatch[1].toLowerCase())) {
        endpoints.push({
          method: methodMatch[1].toUpperCase(),
          path: currentPath,
        });
      }

      // Reset on next top-level key
      if (/^\S/.test(line) && !line.startsWith("#")) {
        currentPath = "";
      }
    }
  }

  return endpoints;
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
  const apiModPath = path.join(ROOT, "crates", "routa-server", "src", "api", "mod.rs");
  if (!fs.existsSync(apiModPath)) {
    console.error("❌ Rust api/mod.rs not found");
    process.exit(1);
  }

  const apiModContent = fs.readFileSync(apiModPath, "utf-8");
  const endpoints: RouteEndpoint[] = [];

  // Extract nest paths: .nest("/api/agents", agents::router())
  const nestRegex = /\.nest\("([^"]+)",\s*(\w+)::router\(\)\)/g;
  const nests: { basePath: string; module: string }[] = [];
  let nestMatch;
  while ((nestMatch = nestRegex.exec(apiModContent)) !== null) {
    nests.push({ basePath: nestMatch[1], module: nestMatch[2] });
  }

  // For each module, parse the router() function to extract routes
  const apiDir = path.join(ROOT, "crates", "routa-server", "src", "api");

  for (const nest of nests) {
    const moduleFile = path.join(apiDir, `${nest.module}.rs`);
    if (!fs.existsSync(moduleFile)) continue;

    const content = fs.readFileSync(moduleFile, "utf-8");

    // Extract all .route("path", ...) calls using a state-machine approach
    // to handle nested parentheses in handler chains
    const routeCalls = extractRouteCalls(content);

    for (const { subPath, handlerChain } of routeCalls) {
      const fullPath = subPath === "/"
        ? nest.basePath
        : `${nest.basePath}${subPath}`;

      // Extract methods from handler chain
      extractMethods(handlerChain).forEach((m) => {
        endpoints.push({ method: m, path: fullPath });
      });
    }
  }

  // Also check for direct routes in mod.rs and lib.rs (like health_check)
  const directFiles = [apiModContent];
  const libPath = path.join(ROOT, "crates", "routa-server", "src", "lib.rs");
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
  // Multi-segment params like /notes/{workspaceId}/{noteId} → /notes/{p}/{p}
  const normalizedPath = e.path
    .replace(/\[([^\]]+)\]/g, "{p}")      // Next.js [param] → {p}
    .replace(/\{[^}]+\}/g, "{p}")         // Any {param} → {p}
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
  const totalIssues =
    report.missingInNextjs.length +
    report.missingInRust.length +
    report.missingInContract.length;

  if (totalIssues === 0) {
    console.log(`${ok} All backends are in sync with the contract!\n`);
  } else {
    console.log(`── Summary: ${totalIssues} parity issue(s) found ──\n`);
  }

  return totalIssues;
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
function main() {
  const contract = parseContract();
  const nextjs = parseNextjsRoutes();
  const rust = parseRustRoutes();
  const report = compareRoutes(contract, nextjs, rust);

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
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
        },
        null,
        2
      )
    );
    const totalIssues = report.missingInNextjs.length + report.missingInRust.length;
    process.exit(totalIssues > 0 ? 1 : 0);
  }

  const issues = printReport(report);
  process.exit(issues > 0 ? 1 : 0);
}

main();
