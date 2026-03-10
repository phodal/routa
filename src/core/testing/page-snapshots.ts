import fs from "node:fs";
import path from "node:path";

import snapshotRegistry from "../../../resources/page-snapshot-registry.json";

export type SnapshotPriority = "P0" | "P1" | "P2";
export type SnapshotWaitStrategy = "networkidle" | "selector" | "text";

export interface PageSnapshotWaitFor {
  strategy: SnapshotWaitStrategy;
  value?: string;
  timeoutMs?: number;
  settleMs?: number;
}

export interface PageSnapshotTarget {
  id: string;
  name: string;
  group: string;
  priority: SnapshotPriority;
  route: string;
  pageFile: string;
  snapshotFile: string;
  waitFor?: PageSnapshotWaitFor;
}

export interface PageSnapshotElement {
  type: string;
  ref?: string;
  label?: string;
  line: string;
}

export interface ParsedPageSnapshot {
  metadata: Record<string, string>;
  snapshotText: string;
  elements: PageSnapshotElement[];
}

const ROOT_DIR = process.cwd();
const TYPE_PATTERN = /^\s*-\s+([a-z][a-z0-9-]*)\b/i;
const LABEL_PATTERN = /"([^"]+)"/;
const REF_PATTERN = /\[ref=([^\]]+)\]/;

function validateRegistry(entries: unknown): PageSnapshotTarget[] {
  if (!Array.isArray(entries)) {
    throw new Error("Page snapshot registry must be an array");
  }

  const ids = new Set<string>();

  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid page snapshot registry entry");
    }

    const target = entry as Partial<PageSnapshotTarget>;

    if (!target.id || !target.route || !target.pageFile || !target.snapshotFile) {
      throw new Error(`Registry entry is missing required fields: ${JSON.stringify(entry)}`);
    }

    if (ids.has(target.id)) {
      throw new Error(`Duplicate page snapshot target id: ${target.id}`);
    }
    ids.add(target.id);

    return {
      id: target.id,
      name: target.name ?? target.id,
      group: target.group ?? "default",
      priority: target.priority ?? "P2",
      route: target.route,
      pageFile: target.pageFile,
      snapshotFile: target.snapshotFile,
      waitFor: target.waitFor,
    };
  });
}

const targets = validateRegistry(snapshotRegistry);

export function listPageSnapshotTargets(): PageSnapshotTarget[] {
  return targets;
}

export function getPageSnapshotTarget(id: string): PageSnapshotTarget | undefined {
  return targets.find((target) => target.id === id);
}

export function resolvePageSnapshotPath(relativePath: string): string {
  return path.join(ROOT_DIR, relativePath);
}

export function snapshotExists(target: PageSnapshotTarget): boolean {
  return fs.existsSync(resolvePageSnapshotPath(target.snapshotFile));
}

export function parsePageSnapshotContent(content: string): ParsedPageSnapshot {
  const lines = content.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (!line.startsWith("#")) {
      break;
    }

    const match = line.match(/^#\s*([^:]+):\s*(.*)$/);
    if (match) {
      metadata[match[1].trim()] = match[2].trim();
    }
    index += 1;
  }

  const snapshotText = lines.slice(index).join("\n").trim();

  return {
    metadata,
    snapshotText,
    elements: extractPageSnapshotElements(snapshotText),
  };
}

export function extractPageSnapshotElements(
  snapshotText: string,
  elementType?: string,
): PageSnapshotElement[] {
  const requestedType = elementType?.trim().toLowerCase();

  return snapshotText
    .split(/\r?\n/)
    .map((line) => {
      const typeMatch = line.match(TYPE_PATTERN);
      if (!typeMatch) {
        return null;
      }

      const type = typeMatch[1].toLowerCase();
      if (requestedType && type !== requestedType) {
        return null;
      }

      const refMatch = line.match(REF_PATTERN);
      const labelMatch = line.match(LABEL_PATTERN);

      return {
        type,
        ref: refMatch?.[1],
        label: labelMatch?.[1],
        line: line.trim(),
      } satisfies PageSnapshotElement;
    })
    .filter((element): element is PageSnapshotElement => element !== null);
}

export function readPageSnapshot(targetId: string):
  | { target: PageSnapshotTarget; rawContent: string; parsed: ParsedPageSnapshot }
  | null {
  const target = getPageSnapshotTarget(targetId);
  if (!target) {
    return null;
  }

  const filePath = resolvePageSnapshotPath(target.snapshotFile);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const rawContent = fs.readFileSync(filePath, "utf-8");
  return {
    target,
    rawContent,
    parsed: parsePageSnapshotContent(rawContent),
  };
}