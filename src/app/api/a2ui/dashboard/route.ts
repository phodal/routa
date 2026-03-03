/**
 * A2UI Dashboard API
 *
 * GET  /api/a2ui/dashboard?workspaceId=...  → Returns A2UI v0.10 messages for the workspace dashboard
 * POST /api/a2ui/dashboard                  → Accepts custom A2UI messages to add to the dashboard
 *
 * Content-Type: application/json+a2ui (per A2UI spec) or application/json
 */

import { NextRequest, NextResponse } from "next/server";

// In-memory store for custom surfaces per workspace (in production, persist to DB)
const customSurfaceStore = new Map<string, unknown[]>();

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") || "default";

  try {
    // Fetch workspace data from existing APIs
    const baseUrl = req.nextUrl.origin;

    const [sessionsRes, tasksRes, bgTasksRes, tracesRes] = await Promise.all([
      fetch(`${baseUrl}/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=20`, { cache: "no-store" }),
      fetch(`${baseUrl}/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
      fetch(`${baseUrl}/api/background-tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
      fetch(`${baseUrl}/api/traces?limit=10`, { cache: "no-store" }),
    ]);

    const [sessionsData, tasksData, bgTasksData, tracesData] = await Promise.all([
      sessionsRes.json().catch(() => ({ sessions: [] })),
      tasksRes.json().catch(() => ({ tasks: [] })),
      bgTasksRes.json().catch(() => ({ tasks: [] })),
      tracesRes.json().catch(() => ({ traces: [] })),
    ]);

    // Import the generator dynamically to avoid client-side module issues
    const { generateDashboardA2UI } = await import("@/client/a2ui/dashboard-generator");

    const dashboardData = {
      workspace: { id: workspaceId, title: workspaceId === "default" ? "Default Workspace" : workspaceId, status: "active" },
      sessions: Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [],
      agents: [], // Would need RPC call
      tasks: Array.isArray(tasksData?.tasks) ? tasksData.tasks : [],
      bgTasks: Array.isArray(bgTasksData?.tasks) ? bgTasksData.tasks : [],
      codebases: [],
      notes: [],
      traces: Array.isArray(tracesData?.traces) ? tracesData.traces.slice(0, 8) : [],
    };

    const messages = generateDashboardA2UI(dashboardData);

    // Append any custom surfaces for this workspace
    const customSurfaces = customSurfaceStore.get(workspaceId) || [];

    return NextResponse.json(
      {
        data: [...messages, ...customSurfaces],
        kind: "data",
        metadata: { mimeType: "application/json+a2ui" },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-A2UI-Version": "v0.10",
        },
      }
    );
  } catch (error) {
    console.error("[A2UI] Error generating dashboard:", error);
    return NextResponse.json(
      { error: "Failed to generate A2UI dashboard" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const workspaceId = body.workspaceId || "default";
    const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.data) ? body.data : [body];

    // Validate A2UI messages
    for (const msg of messages) {
      if (msg.version !== "v0.10") {
        return NextResponse.json(
          { error: `Invalid A2UI version: ${msg.version}. Expected "v0.10"` },
          { status: 400 }
        );
      }
      const hasValidType =
        "createSurface" in msg ||
        "updateComponents" in msg ||
        "updateDataModel" in msg ||
        "deleteSurface" in msg;
      if (!hasValidType) {
        return NextResponse.json(
          { error: "Each message must contain one of: createSurface, updateComponents, updateDataModel, deleteSurface" },
          { status: 400 }
        );
      }
    }

    // Store custom surfaces
    const existing = customSurfaceStore.get(workspaceId) || [];
    customSurfaceStore.set(workspaceId, [...existing, ...messages]);

    return NextResponse.json({
      success: true,
      surfaceCount: messages.filter((m: Record<string, unknown>) => "createSurface" in m).length,
      totalMessages: messages.length,
    });
  } catch (error) {
    console.error("[A2UI] Error processing custom surface:", error);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
