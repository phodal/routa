/**
 * /api/workflows/[id] — Get, Update, Delete a specific workflow.
 *
 * GET    /api/workflows/[id]  → Get workflow YAML content
 * PUT    /api/workflows/[id]  → Replace workflow YAML content
 * DELETE /api/workflows/[id]  → Delete the workflow file
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export const dynamic = "force-dynamic";

const FLOWS_DIR = path.join(process.cwd(), "resources", "flows");

function getFilePath(id: string): string {
  return path.join(FLOWS_DIR, `${id}.yaml`);
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const filePath = getFilePath(id);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = yaml.load(content) as Record<string, unknown>;
    } catch {
      // Return raw content even if YAML is invalid
    }

    return NextResponse.json({
      workflow: {
        id,
        name: (parsed?.name as string) ?? id,
        description: (parsed?.description as string) ?? "",
        version: (parsed?.version as string) ?? "1.0",
        trigger: parsed?.trigger,
        steps: Array.isArray(parsed?.steps) ? parsed.steps : [],
        yamlContent: content,
      },
    });
  } catch (err) {
    console.error("[Workflows] GET [id] error:", err);
    return NextResponse.json(
      { error: "Failed to get workflow", details: String(err) },
      { status: 500 }
    );
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const filePath = getFilePath(id);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body?.yamlContent) {
      return NextResponse.json({ error: "Required: yamlContent" }, { status: 400 });
    }

    // Validate YAML content
    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(body.yamlContent) as Record<string, unknown>;
    } catch (err) {
      return NextResponse.json({ error: `Invalid YAML: ${err}` }, { status: 400 });
    }

    if (!parsed?.name || !Array.isArray(parsed?.steps) || parsed.steps.length === 0) {
      return NextResponse.json(
        { error: "Workflow YAML must have name and at least one step" },
        { status: 400 }
      );
    }

    await fs.promises.writeFile(filePath, body.yamlContent, "utf-8");

    return NextResponse.json({
      workflow: {
        id,
        name: parsed.name as string,
        description: (parsed.description as string) ?? "",
        version: (parsed.version as string) ?? "1.0",
        trigger: parsed.trigger,
        steps: parsed.steps,
        yamlContent: body.yamlContent,
      },
    });
  } catch (err) {
    console.error("[Workflows] PUT [id] error:", err);
    return NextResponse.json(
      { error: "Failed to update workflow", details: String(err) },
      { status: 500 }
    );
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const filePath = getFilePath(id);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    await fs.promises.unlink(filePath);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Workflows] DELETE [id] error:", err);
    return NextResponse.json(
      { error: "Failed to delete workflow", details: String(err) },
      { status: 500 }
    );
  }
}
