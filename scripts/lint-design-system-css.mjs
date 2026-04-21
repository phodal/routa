#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

const shellFiles = [
  "src/client/components/desktop-app-shell.tsx",
  "src/client/components/desktop-layout.tsx",
  "src/client/components/desktop-sidebar.tsx",
  "src/client/components/desktop-nav-rail.tsx",
];

const tokenPresenceFiles = [
  "src/client/components/workspace-switcher.tsx",
];

const brandSemanticFiles = [
  "src/client/a2ui/types.ts",
  "src/client/a2ui/renderer.tsx",
  "src/client/a2ui/dashboard-generator.ts",
  "src/client/components/compact-stat.tsx",
  "src/app/workspace/[workspaceId]/ui-components.tsx",
  "src/core/models/kanban.ts",
  "crates/routa-core/src/models/kanban.rs",
];

const desktopThemeFile = "src/app/styles/desktop-theme.css";
const violations = [];
const brandSemanticsOnly = process.argv.includes("--brand-semantics");
const advisoryColorSystemOnly = process.argv.includes("--color-system-warnings");
const strictColorSystemOnly = process.argv.includes("--color-system-strict");
const explicitScanFiles = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

const advisoryScanTargets = [
  "src/app",
  "src/client",
];

const advisoryIgnorePatterns = [
  /\/globals\.css$/,
  /\/desktop-theme\.css$/,
  /\/custom\.css$/,
  /\.stories\.(ts|tsx)$/,
  /\/__tests__\//,
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
];

const allowedSemanticColorVariables = new Set([
  "var(--background)",
  "var(--foreground)",
  "var(--surface)",
  "var(--surface-muted)",
  "var(--border)",
  "var(--border-strong)",
  "var(--accent)",
  "var(--accent-hover)",
  "var(--accent-foreground)",
  "var(--muted)",
  "var(--muted-foreground)",
  "var(--card)",
  "var(--card-foreground)",
  "var(--popover)",
  "var(--popover-foreground)",
  "var(--input)",
  "var(--ring)",
  "var(--primary)",
  "var(--primary-foreground)",
  "var(--secondary)",
  "var(--secondary-foreground)",
  "var(--destructive)",
  "var(--destructive-foreground)",
  "var(--danger-subtle)",
  "var(--danger-subtle-hover)",
  "var(--danger-border)",
  "var(--danger-border-strong)",
  "var(--danger-fg)",
  "var(--danger-fg-strong)",
  "var(--danger-solid)",
  "var(--danger-solid-hover)",
  "var(--danger-on-solid)",
  "var(--danger-ring)",
]);

const allowedTokenVariablePattern = /^var\(--(?:dt|brand|color-desktop)-[a-zA-Z0-9-]+\)$/;

function isAllowedColorTokenExpression(expression) {
  const normalizedExpression = expression.trim();
  return (
    allowedSemanticColorVariables.has(normalizedExpression) ||
    allowedTokenVariablePattern.test(normalizedExpression)
  );
}

const forbiddenColorPatterns = [
  {
    name: "hardcoded hex colors",
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    name: "rgb/rgba colors",
    pattern: /\brgba?\(/g,
  },
  {
    name: "tailwind bracket colors",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-\[(?<colorExpr>#[^\]]+|(?:rgb|rgba|hsl|hsla)\([^\]]+\)|var\([^\]]+\))\]/g,
    allow: (match) => isAllowedColorTokenExpression(match.groups?.colorExpr ?? ""),
  },
  {
    name: "tailwind palette classes",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?\b/g,
  },
];

const forbiddenLegacySemanticPattern = /\b(?:violet|indigo|purple)\b/g;
const advisoryForbiddenColorPatterns = [
  {
    name: "hardcoded hex colors",
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    name: "rgb/rgba colors",
    pattern: /\brgba?\(/g,
  },
  {
    name: "tailwind bracket colors",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-\[(?<colorExpr>#[^\]]+|(?:rgb|rgba|hsl|hsla)\([^\]]+\)|var\([^\]]+\))\]/g,
    allow: (match) => isAllowedColorTokenExpression(match.groups?.colorExpr ?? ""),
  },
  {
    name: "non-system tailwind palette classes",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-(?:gray|zinc|neutral|stone|orange|yellow|lime|green|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?\b/g,
  },
];

function advisoryPriorityLevel(count) {
  if (count >= 20) return "high";
  if (count >= 10) return "medium";
  return "low";
}

function advisoryPriorityLabel(level) {
  if (level === "high") return "HIGH";
  if (level === "medium") return "MEDIUM";
  return "LOW";
}

function collectColorWarnings(files, rules, modeLabel) {
  const warnings = [];
  const warningsByFile = new Map();
  const warningsByRule = new Map();

  for (const file of files) {
    const content = readFile(file);
    for (const rule of rules) {
      for (const match of content.matchAll(rule.pattern)) {
        if (rule.allow?.(match)) continue;
        const warning = `${file}:${collectLineNumber(content, match.index ?? 0)} ${modeLabel} ${rule.name}: ${match[0]}`;
        warnings.push(warning);
        warningsByFile.set(file, (warningsByFile.get(file) ?? 0) + 1);
        warningsByRule.set(rule.name, (warningsByRule.get(rule.name) ?? 0) + 1);
      }
    }
  }

  return { warnings, warningsByFile, warningsByRule };
}

function printColorWarningSummary(header, warnings, warningsByFile, warningsByRule) {
  console.log(`${header} (${warnings.length}).`);
  console.log("");
  console.log("Priority files:");
  for (const [file, count] of [...warningsByFile.entries()].sort((left, right) => right[1] - left[1]).slice(0, 15)) {
    const level = advisoryPriorityLevel(count);
    console.log(`- [${advisoryPriorityLabel(level)}] ${file} (${count} warnings)`);
  }
  console.log("");
  console.log("Warning classes:");
  for (const [ruleName, count] of [...warningsByRule.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`- ${ruleName}: ${count}`);
  }
  console.log("");
  console.log("Detailed warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf-8");
}

function collectLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function addViolation(file, line, message) {
  violations.push(`${file}:${line} ${message}`);
}

function collectFiles(targetPath) {
  const absoluteTarget = path.join(rootDir, targetPath);
  if (!fs.existsSync(absoluteTarget)) return [];

  const stat = fs.statSync(absoluteTarget);
  if (stat.isFile()) return [targetPath];

  const files = [];
  for (const entry of fs.readdirSync(absoluteTarget, { withFileTypes: true })) {
    const relativeEntryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(relativeEntryPath));
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
    if (advisoryIgnorePatterns.some((pattern) => pattern.test(relativeEntryPath))) continue;
    files.push(relativeEntryPath);
  }
  return files;
}

function advisoryScan() {
  const files = advisoryScanTargets.flatMap((target) => collectFiles(target));
  const { warnings, warningsByFile, warningsByRule } = collectColorWarnings(files, advisoryForbiddenColorPatterns, "advisory");

  if (warnings.length > 0) {
    printColorWarningSummary("Color system advisory lint completed with warnings", warnings, warningsByFile, warningsByRule);
    return;
  }

  console.log("Color system advisory lint completed without warnings.");
}

if (advisoryColorSystemOnly) {
  advisoryScan();
  process.exit(0);
}

function strictColorSystemScan() {
  const files = explicitScanFiles.length > 0
    ? explicitScanFiles
    : advisoryScanTargets.flatMap((target) => collectFiles(target));
  const { warnings, warningsByFile, warningsByRule } = collectColorWarnings(files, advisoryForbiddenColorPatterns, "strict");

  if (warnings.length > 0) {
    printColorWarningSummary("Color system strict lint failed", warnings, warningsByFile, warningsByRule);
    process.exit(1);
  }

  console.log("Color system strict lint passed.");
}

if (strictColorSystemOnly) {
  strictColorSystemScan();
  process.exit(0);
}

if (!brandSemanticsOnly) {
  for (const file of shellFiles) {
    const content = readFile(file);
    for (const rule of forbiddenColorPatterns) {
      for (const match of content.matchAll(rule.pattern)) {
        addViolation(file, collectLineNumber(content, match.index ?? 0), `forbidden ${rule.name}: ${match[0]}`);
      }
    }
  }

  for (const file of tokenPresenceFiles) {
    const content = readFile(file);
    const requiredTokens = ["bg-desktop-", "text-desktop-", "border-desktop-"];
    for (const token of requiredTokens) {
      if (!content.includes(token)) {
        addViolation(file, 1, `missing desktop token usage containing "${token}"`);
      }
    }
  }

  const desktopThemeContent = readFile(desktopThemeFile);
  for (const match of desktopThemeContent.matchAll(/--[a-zA-Z0-9-]+\s*:/g)) {
    const variableName = match[0].replace(/\s*:$/, "");
    const allowed =
      variableName.startsWith("--dt-") ||
      variableName.startsWith("--color-desktop-");
    if (!allowed) {
      addViolation(
        desktopThemeFile,
        collectLineNumber(desktopThemeContent, match.index ?? 0),
        `unexpected CSS variable prefix: ${variableName}`,
      );
    }
  }
}

for (const file of brandSemanticFiles) {
  const content = readFile(file);
  for (const match of content.matchAll(forbiddenLegacySemanticPattern)) {
    addViolation(file, collectLineNumber(content, match.index ?? 0), `forbidden legacy semantic color key: ${match[0]}`);
  }
}

if (violations.length > 0) {
  console.error(brandSemanticsOnly ? "Brand semantic lint failed.\n" : "Design-system CSS lint failed.\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(brandSemanticsOnly ? "Brand semantic lint passed." : "Design-system CSS lint passed.");
