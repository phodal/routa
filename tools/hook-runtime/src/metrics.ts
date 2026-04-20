import { readFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import yaml from "js-yaml";

export type HookMetric = {
  command: string;
  description?: string;
  hardGate: boolean;
  name: string;
  pattern?: string;
  serial?: boolean;
  sourceFile: string;
};

type FitnessManifest = {
  evidence_files?: string[];
};

type FrontmatterMetric = {
  command?: string;
  description?: string;
  hard_gate?: boolean;
  name?: string;
  pattern?: string;
  serial?: boolean;
};

const FITNESS_DIR = path.join(process.cwd(), "docs", "fitness");
const MANIFEST_PATH = path.join(FITNESS_DIR, "manifest.yaml");

function isManifestMissingError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function loadManifestFile(): Promise<string> {
  try {
    return await readFile(MANIFEST_PATH, "utf-8");
  } catch (error) {
    if (isManifestMissingError(error)) {
      throw new Error(
        'Cannot find fitness manifest at "docs/fitness/manifest.yaml". ' +
          "Create this file and define evidence_files before running hook-runtime.",
        { cause: error },
      );
    }

    throw error;
  }
}

async function loadManifestFiles(): Promise<string[]> {
  const raw = await loadManifestFile();
  const manifest = (yaml.load(raw) ?? {}) as FitnessManifest;
  return manifest.evidence_files ?? [];
}

export async function loadHookMetrics(names: string[]): Promise<HookMetric[]> {
  const wanted = new Set(names);
  const files = await loadManifestFiles();
  const found = new Map<string, HookMetric>();

  for (const relativeFile of files) {
    const absoluteFile = path.join(process.cwd(), relativeFile);
    const raw = await readFile(absoluteFile, "utf-8");
    const parsed = matter(raw);
    const metrics = Array.isArray(parsed.data.metrics) ? parsed.data.metrics : [];

    for (const entry of metrics as FrontmatterMetric[]) {
      if (!entry?.name || !wanted.has(entry.name) || !entry.command) {
        continue;
      }

      found.set(entry.name, {
        name: entry.name,
        command: entry.command,
        pattern: entry.pattern,
        description: entry.description,
        hardGate: Boolean(entry.hard_gate),
        serial: Boolean(entry.serial),
        sourceFile: relativeFile,
      });
    }
  }

  return names.map((name) => {
    const metric = found.get(name);
    if (!metric) {
      throw new Error(`Unable to find fitness metric "${name}" in docs/fitness manifest files.`);
    }
    return metric;
  });
}
