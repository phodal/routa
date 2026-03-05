/**
 * /api/workflows — CRUD API for workflow YAML definitions.
 *
 * GET  /api/workflows  → List all workflows in resources/flows/
 * POST /api/workflows  → Create a new workflow YAML file
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export const dynamic = "force-dynamic";

const FLOWS_DIR = path.join(process.cwd(), "resources", "flows");

function ensureFlowsDir() {
  if (!fs.existsSync(FLOWS_DIR)) {
    fs.mkdirSync(FLOWS_DIR, { recursive: true });
  }
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    ensureFlowsDir();
    const files = await fs.promises.readdir(FLOWS_DIR);
    const workflows = [];

    for (const file of files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))) {
      const id = path.basename(file, path.extname(file));
      const filePath = path.join(FLOWS_DIR, file);
      const content = await fs.promises.readFile(filePath, "utf-8");
      try {
        const parsed = yaml.load(content) as Record<string, unknown>;
        workflows.push({
          id,
          name: (parsed?.name as string) ?? id,
          description: (parsed?.description as string) ?? "",
          version: (parsed?.version as string) ?? "1.0",
          trigger: parsed?.trigger,
          steps: Array.isArray(parsed?.steps) ? parsed.steps : [],
          yamlContent: content,
        });
      } catch {
        // Skip invalid YAML files
      }
    }

    return NextResponse.json({ workflows });
  } catch (err) {
    console.error("[Workflows] GET error:", err);
    return NextResponse.json(
      { error: "Failed to list workflows", details: String(err) },
      { status: 500 }
    );
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { id, yamlContent } = body;
    if (!id || !yamlContent) {
      return NextResponse.json(
        { error: "Required: id, yamlContent" },
        { status: 400 }
      );
    }

    // Validate id (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json(
        { error: "ID must contain only letters, numbers, hyphens, and underscores" },
        { status: 400 }
      );
    }

    // Validate YAML content
    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(yamlContent) as Record<string, unknown>;
    } catch (err) {
      return NextResponse.json({ error: `Invalid YAML: ${err}` }, { status: 400 });
    }

    if (!parsed?.name || !Array.isArray(parsed?.steps) || parsed.steps.length === 0) {
      return NextResponse.json(
        { error: "Workflow YAML must have name and at least one step" },
        { status: 400 }
      );
    }

    ensureFlowsDir();
    const filePath = path.join(FLOWS_DIR, `${id}.yaml`);

    if (fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `Workflow with id "${id}" already exists` },
        { status: 409 }
      );
    }

    await fs.promises.writeFile(filePath, yamlContent, "utf-8");

    return NextResponse.json(
      {
        workflow: {
          id,
          name: parsed.name as string,
          description: (parsed.description as string) ?? "",
          version: (parsed.version as string) ?? "1.0",
          trigger: parsed.trigger,
          steps: parsed.steps,
          yamlContent,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[Workflows] POST error:", err);
    return NextResponse.json(
      { error: "Failed to create workflow", details: String(err) },
      { status: 500 }
    );
  }
}
