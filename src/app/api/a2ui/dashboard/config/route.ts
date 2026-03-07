/**
 * A2UI Dashboard Config API
 *
 * GET  /api/a2ui/dashboard/config?workspaceId=...  - Read dashboard config
 * PUT  /api/a2ui/dashboard/config                  - Save dashboard config
 *
 * Persists panel ordering, visibility, and custom surfaces per workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDatabaseDriver } from "@/core/db";

// ─── Types ───────────────────────────────────────────────────────────────

export interface DashboardConfigData {
  id: string;
  workspaceId: string;
  surfaceOrder: string[] | null;
  hiddenSurfaces: string[] | null;
  customSurfaces: Record<string, unknown>[] | null;
  updatedAt: string;
}

// ─── In-memory fallback ──────────────────────────────────────────────────

const memoryStore = new Map<string, DashboardConfigData>();

// ─── Database helpers ────────────────────────────────────────────────────

async function getConfigFromDb(workspaceId: string): Promise<DashboardConfigData | null> {
  const driver = getDatabaseDriver();

  if (driver === "postgres") {
    const { getDatabase } = await import("@/core/db");
    const { dashboardConfig } = await import("@/core/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDatabase();
    const rows = await db
      .select()
      .from(dashboardConfig)
      .where(eq(dashboardConfig.workspaceId, workspaceId))
      .limit(1);
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      surfaceOrder: row.surfaceOrder ?? null,
      hiddenSurfaces: row.hiddenSurfaces ?? null,
      customSurfaces: row.customSurfaces ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  if (driver === "sqlite") {
    try {
      const { getSqliteDatabase } = require("@/core/db/sqlite") as typeof import("@/core/db/sqlite");
      const sqliteSchema = require("@/core/db/sqlite-schema") as typeof import("@/core/db/sqlite-schema");
      const { eq } = require("drizzle-orm") as typeof import("drizzle-orm");
      const db = getSqliteDatabase();
      const rows = await db
        .select()
        .from(sqliteSchema.dashboardConfig)
        .where(eq(sqliteSchema.dashboardConfig.workspaceId, workspaceId))
        .limit(1);
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        surfaceOrder: row.surfaceOrder ?? null,
        hiddenSurfaces: row.hiddenSurfaces ?? null,
        customSurfaces: row.customSurfaces ?? null,
        updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
      };
    } catch (err) {
      console.warn("[DashboardConfig] SQLite unavailable, using memory:", err);
      return memoryStore.get(workspaceId) ?? null;
    }
  }

  // Memory fallback
  return memoryStore.get(workspaceId) ?? null;
}

async function saveConfigToDb(config: DashboardConfigData): Promise<void> {
  const driver = getDatabaseDriver();

  if (driver === "postgres") {
    const { getDatabase } = await import("@/core/db");
    const { dashboardConfig } = await import("@/core/db/schema");
    const db = getDatabase();
    await db
      .insert(dashboardConfig)
      .values({
        id: config.id,
        workspaceId: config.workspaceId,
        surfaceOrder: config.surfaceOrder,
        hiddenSurfaces: config.hiddenSurfaces,
        customSurfaces: config.customSurfaces,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dashboardConfig.id,
        set: {
          surfaceOrder: config.surfaceOrder,
          hiddenSurfaces: config.hiddenSurfaces,
          customSurfaces: config.customSurfaces,
          updatedAt: new Date(),
        },
      });
    return;
  }

  if (driver === "sqlite") {
    try {
      const { getSqliteDatabase } = require("@/core/db/sqlite") as typeof import("@/core/db/sqlite");
      const sqliteSchema = require("@/core/db/sqlite-schema") as typeof import("@/core/db/sqlite-schema");
      const db = getSqliteDatabase();
      await db
        .insert(sqliteSchema.dashboardConfig)
        .values({
          id: config.id,
          workspaceId: config.workspaceId,
          surfaceOrder: config.surfaceOrder,
          hiddenSurfaces: config.hiddenSurfaces,
          customSurfaces: config.customSurfaces,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: sqliteSchema.dashboardConfig.id,
          set: {
            surfaceOrder: config.surfaceOrder,
            hiddenSurfaces: config.hiddenSurfaces,
            customSurfaces: config.customSurfaces,
            updatedAt: new Date(),
          },
        });
      return;
    } catch (err) {
      console.warn("[DashboardConfig] SQLite unavailable, using memory:", err);
    }
  }

  // Memory fallback
  memoryStore.set(config.workspaceId, config);
}

// ─── GET /api/a2ui/dashboard/config ─────────────────────────────────────

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const config = await getConfigFromDb(workspaceId);
    return NextResponse.json({
      config: config ?? {
        id: `dc_${workspaceId}`,
        workspaceId,
        surfaceOrder: null,
        hiddenSurfaces: null,
        customSurfaces: null,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[DashboardConfig] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard config" },
      { status: 500 }
    );
  }
}

// ─── PUT /api/a2ui/dashboard/config ─────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspaceId, surfaceOrder, hiddenSurfaces, customSurfaces } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Validate arrays if provided
    if (surfaceOrder !== undefined && surfaceOrder !== null && !Array.isArray(surfaceOrder)) {
      return NextResponse.json({ error: "surfaceOrder must be an array" }, { status: 400 });
    }
    if (hiddenSurfaces !== undefined && hiddenSurfaces !== null && !Array.isArray(hiddenSurfaces)) {
      return NextResponse.json({ error: "hiddenSurfaces must be an array" }, { status: 400 });
    }
    if (customSurfaces !== undefined && customSurfaces !== null && !Array.isArray(customSurfaces)) {
      return NextResponse.json({ error: "customSurfaces must be an array" }, { status: 400 });
    }

    const configId = `dc_${workspaceId}`;
    const now = new Date().toISOString();

    const config: DashboardConfigData = {
      id: configId,
      workspaceId,
      surfaceOrder: surfaceOrder ?? null,
      hiddenSurfaces: hiddenSurfaces ?? null,
      customSurfaces: customSurfaces ?? null,
      updatedAt: now,
    };

    await saveConfigToDb(config);

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("[DashboardConfig] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save dashboard config" },
      { status: 500 }
    );
  }
}
