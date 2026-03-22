import * as yaml from "js-yaml";
import { NextRequest, NextResponse } from "next/server";

import { ensureDefaultBoard } from "@/core/kanban/boards";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

interface ExportKanbanConfig {
  version: number;
  name?: string;
  workspaceId: string;
  boards: ExportKanbanBoard[];
}

interface ExportKanbanBoard {
  id: string;
  name: string;
  isDefault?: boolean;
  columns: ExportKanbanColumn[];
}

interface ExportKanbanColumn {
  id: string;
  name: string;
  color?: string;
  stage: string;
  automation?: Record<string, unknown>;
  visible?: boolean;
  width?: "compact" | "standard" | "wide";
}

function normalizeAutomation(automation: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!automation) {
    return undefined;
  }
  const normalized = { ...automation };
  const steps = Array.isArray(normalized.steps) ? normalized.steps : [];
  const hasEffectiveConfig = Boolean(
    normalized.providerId
    || normalized.role
    || normalized.specialistId
    || normalized.specialistName
    || steps.length > 0,
  );
  if (hasEffectiveConfig && normalized.enabled === undefined) {
    normalized.enabled = true;
  }
  return normalized;
}

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toExportConfig(workspaceId: string, workspaceTitle: string | undefined, boards: Array<{
  id: string;
  name: string;
  isDefault: boolean;
  columns: Array<{
    id: string;
    name: string;
    color?: string | null;
    position: number;
    stage: string;
    automation?: Record<string, unknown>;
    visible?: boolean;
    width?: "compact" | "standard" | "wide";
  }>;
}>): ExportKanbanConfig {
  return {
    version: 1,
    name: workspaceTitle ? `${workspaceTitle} Kanban` : undefined,
    workspaceId,
    boards: boards.map((board) => ({
      id: board.id,
      name: board.name,
      isDefault: board.isDefault || undefined,
      columns: [...board.columns]
        .sort((left, right) => left.position - right.position)
        .map((column) => ({
          id: column.id,
          name: column.name,
          color: column.color ?? undefined,
          stage: column.stage,
          automation: normalizeAutomation(column.automation),
          visible: column.visible,
          width: column.width,
        })),
    })),
  };
}

function buildFileName(workspaceId: string): string {
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `kanban-${safeId || "default"}.yaml`;
}

export async function GET(request: NextRequest) {
  const workspaceId = requireWorkspaceId(request.nextUrl.searchParams.get("workspaceId"));
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  await ensureDefaultBoard(system, workspaceId);

  const [workspace, boards] = await Promise.all([
    system.workspaceStore.get(workspaceId),
    system.kanbanBoardStore.listByWorkspace(workspaceId),
  ]);

  const exportConfig = toExportConfig(
    workspaceId,
    workspace?.title,
    boards.map((board) => ({
      id: board.id,
      name: board.name,
      isDefault: board.isDefault,
      columns: board.columns.map((column) => ({
        id: column.id,
        name: column.name,
        color: column.color ?? undefined,
        position: Number(column.position),
        stage: column.stage,
        automation: column.automation as Record<string, unknown> | undefined,
        visible: column.visible,
        width: column.width,
      })),
    })),
  );

  const yamlContent = yaml.dump(exportConfig);

  return new NextResponse(yamlContent, {
    status: 200,
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildFileName(workspaceId)}"`,
      "Cache-Control": "no-store",
    },
  });
}
