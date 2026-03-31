import fs from "fs";
import path from "path";
import type {
  DesignDecisionArtifact,
  DesignDecisionSource,
  DesignDecisionResponse,
  DesignDecisionStatus,
} from "@/core/harness/design-decision-types";

function fileExists(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function normalizeLineEndings(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFrontmatterValue(source: string, key: string): string | null {
  const normalized = normalizeLineEndings(source);
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return null;
  }
  const frontmatter = normalized.slice(4, endIndex);
  const matcher = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "m");
  const match = frontmatter.match(matcher);
  if (!match) {
    return null;
  }
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function extractSectionBody(source: string, heading: string): string | null {
  const normalized = normalizeLineEndings(source);
  const matcher = new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "m",
  );
  const match = normalized.match(matcher);
  return match?.[1]?.trim() ?? null;
}

function extractFirstParagraph(source: string | null | undefined): string | null {
  if (!source) {
    return null;
  }
  const normalized = normalizeLineEndings(source).trim();
  if (!normalized) {
    return null;
  }
  const paragraphs = normalized.split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const candidate = paragraph.trim();
    if (!candidate) {
      continue;
    }
    if (candidate.startsWith("- ") || /^\d+\.\s/.test(candidate) || candidate.startsWith("```")) {
      continue;
    }
    return candidate.replace(/\n+/g, " ").trim();
  }
  return null;
}

function extractListItems(source: string | null | undefined): string[] {
  if (!source) {
    return [];
  }
  return normalizeLineEndings(source)
    .split("\n")
    .map((line) => line.match(/^\s*(?:-|\d+\.)\s+(.+)$/)?.[1]?.trim() ?? null)
    .filter((item): item is string => Boolean(item));
}

function extractCodeReferences(source: string | null | undefined): string[] {
  return extractListItems(source).map((item) => {
    const backtickMatch = item.match(/`([^`]+)`/);
    if (backtickMatch) {
      return backtickMatch[1].trim();
    }
    const plain = item.split("—")[0]?.split("-")[0]?.trim();
    return plain || item;
  });
}

function normalizeAdrStatus(source: string): DesignDecisionStatus {
  const match = normalizeLineEndings(source).match(/^- Status:\s+(.+)$/mi);
  if (!match) {
    return "unknown";
  }
  const value = match[1].trim().toLowerCase();
  if (value === "accepted") return "accepted";
  if (value === "superseded") return "superseded";
  if (value === "deprecated") return "deprecated";
  return "unknown";
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function buildArchitectureArtifact(sourcePath: string, source: string): DesignDecisionArtifact {
  const purpose = extractFrontmatterValue(source, "purpose");
  const principles = extractListItems(extractSectionBody(source, "Core Principles"));
  return {
    id: "architecture-top-level",
    title: "Top-level architecture contract",
    path: sourcePath,
    type: "architecture",
    status: "canonical",
    summary: purpose
      ?? extractFirstParagraph(extractSectionBody(source, "Core Principles"))
      ?? "Canonical architecture overview for runtime boundaries and cross-backend invariants.",
    codeRefs: principles,
  };
}

function buildAdrArtifact(sourcePath: string, source: string): DesignDecisionArtifact | null {
  const titleMatch = normalizeLineEndings(source).match(/^#\s+ADR\s+(\d+):\s+(.+)$/m);
  if (!titleMatch) {
    return null;
  }
  const adrNumber = titleMatch[1];
  const title = titleMatch[2].trim();
  const decisionSection = extractSectionBody(source, "Decision");
  const consequencesSection = extractSectionBody(source, "Consequences");
  const codeRefsSection = extractSectionBody(source, "Code References");

  return {
    id: `adr-${adrNumber}`,
    title,
    path: sourcePath,
    type: "adr",
    status: normalizeAdrStatus(source),
    summary: extractFirstParagraph(decisionSection)
      ?? extractFirstParagraph(consequencesSection)
      ?? "Accepted design decision recorded in ADR.",
    codeRefs: extractCodeReferences(codeRefsSection),
  };
}

function readArchitectureSource(repoRoot: string, warnings: string[]): DesignDecisionSource[] {
  const candidates = [
    { relativePath: "docs/ARCHITECTURE.md", absolutePath: path.join(repoRoot, "docs", "ARCHITECTURE.md") },
    { relativePath: "docs/architecture.md", absolutePath: path.join(repoRoot, "docs", "architecture.md") },
    { relativePath: "docs/architcture.md", absolutePath: path.join(repoRoot, "docs", "architcture.md") },
  ];
  const matched = candidates.find((candidate) => fileExists(candidate.absolutePath));
  if (!matched) {
    warnings.push("No canonical architecture document found under docs/ARCHITECTURE.md.");
    return [];
  }
  const source = fs.readFileSync(matched.absolutePath, "utf-8");
  return [{
    kind: "canonical-doc",
    label: "Architecture",
    rootPath: "docs",
    confidence: "high",
    status: "documents-present",
    artifacts: [buildArchitectureArtifact(matched.relativePath, source)],
  }];
}

function readAdrSource(repoRoot: string, warnings: string[]): DesignDecisionSource[] {
  const adrDir = path.join(repoRoot, "docs", "adr");
  if (!fs.existsSync(adrDir) || !fs.statSync(adrDir).isDirectory()) {
    warnings.push("No docs/adr directory found for design decision loading.");
    return [];
  }
  const artifacts: DesignDecisionArtifact[] = [];
  for (const fileName of fs.readdirSync(adrDir).sort()) {
    if (fileName === "README.md" || !fileName.toLowerCase().endsWith(".md")) {
      continue;
    }
    const absolutePath = path.join(adrDir, fileName);
    if (!fs.statSync(absolutePath).isFile()) {
      continue;
    }
    const source = fs.readFileSync(absolutePath, "utf-8");
    const artifact = buildAdrArtifact(`docs/adr/${fileName}`, source);
    if (!artifact) {
      warnings.push(`Skipped ADR without recognizable title format: docs/adr/${fileName}`);
      continue;
    }
    artifacts.push(artifact);
  }
  if (artifacts.length === 0) {
    return [];
  }
  return [{
    kind: "decision-records",
    label: "ADRs",
    rootPath: "docs/adr",
    confidence: "high",
    status: "documents-present",
    artifacts,
  }];
}

export function detectDesignDecisions(repoRoot: string): DesignDecisionResponse {
  const warnings: string[] = [];
  const sources = unique([
    ...readArchitectureSource(repoRoot, warnings),
    ...readAdrSource(repoRoot, warnings),
  ]).filter((source): source is DesignDecisionSource => Boolean(source));

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    sources,
    warnings,
  };
}
