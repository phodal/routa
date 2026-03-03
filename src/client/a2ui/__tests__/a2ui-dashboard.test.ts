/**
 * Tests for A2UI dashboard generator and message processor
 */

import { describe, it, expect } from "vitest";
import { generateDashboardA2UI, generateCustomSurfaceA2UI } from "../dashboard-generator";
import { processA2UIMessages } from "../renderer";
import type { A2UIMessage, A2UIComponent } from "../types";

describe("A2UI Dashboard Generator", () => {
  const sampleData = {
    workspace: { id: "ws-1", title: "Test Workspace", status: "active" },
    sessions: [
      { sessionId: "s1", name: "Session 1", provider: "openai", role: "routa", createdAt: new Date().toISOString() },
      { sessionId: "s2", provider: "anthropic", createdAt: new Date().toISOString() },
    ],
    agents: [
      { id: "a1", name: "Developer Bot", role: "DEVELOPER", status: "ACTIVE" },
      { id: "a2", name: "Crafter", role: "CRAFTER", status: "PENDING" },
    ],
    tasks: [
      { id: "t1", title: "Fix bug", status: "IN_PROGRESS", createdAt: new Date().toISOString() },
      { id: "t2", title: "Write tests", status: "COMPLETED", createdAt: new Date().toISOString() },
    ],
    bgTasks: [
      { id: "bg1", title: "Run CI", status: "RUNNING", agentId: "a1", triggerSource: "webhook", createdAt: new Date().toISOString() },
      { id: "bg2", title: "Deploy", status: "COMPLETED", agentId: "a2", createdAt: new Date().toISOString() },
    ],
    codebases: [
      { id: "cb1", label: "main-repo", repoPath: "/home/user/repo", branch: "main", isDefault: true },
    ],
    notes: [],
    traces: [
      { id: "tr1", agentName: "Developer Bot", summary: "Completed PR review", createdAt: new Date().toISOString() },
    ],
  };

  it("generates A2UI messages with correct version", () => {
    const messages = generateDashboardA2UI(sampleData);
    expect(messages.length).toBeGreaterThan(0);
    for (const msg of messages) {
      expect(msg.version).toBe("v0.10");
    }
  });

  it("creates stats surface", () => {
    const messages = generateDashboardA2UI(sampleData);
    const createStats = messages.find(
      (m) => "createSurface" in m && m.createSurface.surfaceId === "dashboard_stats"
    );
    expect(createStats).toBeDefined();
  });

  it("creates agent roster surface when agents exist", () => {
    const messages = generateDashboardA2UI(sampleData);
    const createAgents = messages.find(
      (m) => "createSurface" in m && m.createSurface.surfaceId === "dashboard_agents"
    );
    expect(createAgents).toBeDefined();
  });

  it("skips agent roster when no agents", () => {
    const noAgentData = { ...sampleData, agents: [] };
    const messages = generateDashboardA2UI(noAgentData);
    const createAgents = messages.find(
      (m) => "createSurface" in m && (m as { createSurface: { surfaceId: string } }).createSurface.surfaceId === "dashboard_agents"
    );
    expect(createAgents).toBeUndefined();
  });

  it("creates sessions surface when sessions exist", () => {
    const messages = generateDashboardA2UI(sampleData);
    const createSessions = messages.find(
      (m) => "createSurface" in m && m.createSurface.surfaceId === "dashboard_sessions"
    );
    expect(createSessions).toBeDefined();
  });

  it("creates BG tasks surface with status summary", () => {
    const messages = generateDashboardA2UI(sampleData);
    const bgDataModel = messages.find(
      (m) => "updateDataModel" in m && m.updateDataModel.surfaceId === "dashboard_bg_tasks"
    );
    expect(bgDataModel).toBeDefined();
    if (bgDataModel && "updateDataModel" in bgDataModel) {
      const value = bgDataModel.updateDataModel.value as Record<string, unknown>;
      expect(value.bgCount).toBe("2 tasks");
      expect(value.bgStatusSummary).toContain("running");
      expect(value.bgStatusSummary).toContain("completed");
    }
  });

  it("creates codebases surface when codebases exist", () => {
    const messages = generateDashboardA2UI(sampleData);
    const createCB = messages.find(
      (m) => "createSurface" in m && m.createSurface.surfaceId === "dashboard_codebases"
    );
    expect(createCB).toBeDefined();
  });

  it("creates activity surface when traces exist", () => {
    const messages = generateDashboardA2UI(sampleData);
    const createActivity = messages.find(
      (m) => "createSurface" in m && m.createSurface.surfaceId === "dashboard_activity"
    );
    expect(createActivity).toBeDefined();
  });

  it("stats data model has correct counts", () => {
    const messages = generateDashboardA2UI(sampleData);
    const statsData = messages.find(
      (m) => "updateDataModel" in m && m.updateDataModel.surfaceId === "dashboard_stats"
    );
    expect(statsData).toBeDefined();
    if (statsData && "updateDataModel" in statsData) {
      const value = statsData.updateDataModel.value as Record<string, Record<string, string>>;
      expect(value.stats.sessions).toBe("2");
      expect(value.stats.agents).toBe("2");
      expect(value.stats.agentsSub).toBe("1 active");
      expect(value.stats.tasks).toBe("2");
      expect(value.stats.tasksSub).toBe("1 in progress");
      expect(value.stats.bgTasks).toBe("2");
    }
  });

  it("each surface has createSurface + updateComponents + updateDataModel triplet", () => {
    const messages = generateDashboardA2UI(sampleData);
    const surfaceIds = new Set(
      messages
        .filter((m) => "createSurface" in m)
        .map((m) => (m as { createSurface: { surfaceId: string } }).createSurface.surfaceId)
    );

    for (const sid of surfaceIds) {
      const hasComponents = messages.some(
        (m) => "updateComponents" in m && m.updateComponents.surfaceId === sid
      );
      const hasDataModel = messages.some(
        (m) => "updateDataModel" in m && m.updateDataModel.surfaceId === sid
      );
      expect(hasComponents).toBe(true);
      expect(hasDataModel).toBe(true);
    }
  });

  it("all components have required id and component fields", () => {
    const messages = generateDashboardA2UI(sampleData);
    for (const msg of messages) {
      if ("updateComponents" in msg) {
        for (const comp of msg.updateComponents.components) {
          expect(comp.id).toBeDefined();
          expect(typeof comp.id).toBe("string");
          expect(comp.component).toBeDefined();
        }
      }
    }
  });

  it("root component exists in each surface", () => {
    const messages = generateDashboardA2UI(sampleData);
    for (const msg of messages) {
      if ("updateComponents" in msg) {
        const hasRoot = msg.updateComponents.components.some((c) => c.id === "root");
        expect(hasRoot).toBe(true);
      }
    }
  });
});

describe("generateCustomSurfaceA2UI", () => {
  it("generates valid custom surface messages", () => {
    const components: A2UIComponent[] = [
      { id: "root", component: "Card", child: "content" },
      { id: "content", component: "Text", text: "Hello A2UI!", variant: "h3" },
    ];
    const messages = generateCustomSurfaceA2UI(
      "custom_test",
      components,
      { greeting: "Hello" },
      { agentDisplayName: "Test Agent" }
    );

    expect(messages).toHaveLength(3);
    expect(messages[0]).toHaveProperty("createSurface");
    expect(messages[1]).toHaveProperty("updateComponents");
    expect(messages[2]).toHaveProperty("updateDataModel");

    const cs = (messages[0] as { createSurface: { surfaceId: string; theme?: { agentDisplayName?: string } } }).createSurface;
    expect(cs.surfaceId).toBe("custom_test");
    expect(cs.theme?.agentDisplayName).toBe("Test Agent");
  });
});

describe("processA2UIMessages", () => {
  it("creates surfaces from messages", () => {
    const messages: A2UIMessage[] = [
      {
        version: "v0.10",
        createSurface: {
          surfaceId: "test_surface",
          catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
          theme: { agentDisplayName: "Test" },
        },
      },
      {
        version: "v0.10",
        updateComponents: {
          surfaceId: "test_surface",
          components: [
            { id: "root", component: "Text", text: "Hello", variant: "h1" },
          ],
        },
      },
      {
        version: "v0.10",
        updateDataModel: {
          surfaceId: "test_surface",
          value: { name: "World" },
        },
      },
    ];

    const surfaces = processA2UIMessages(messages);
    expect(surfaces.size).toBe(1);

    const surface = surfaces.get("test_surface")!;
    expect(surface.surfaceId).toBe("test_surface");
    expect(surface.theme?.agentDisplayName).toBe("Test");
    expect(surface.components.size).toBe(1);
    expect(surface.components.get("root")?.component).toBe("Text");
    expect(surface.dataModel).toEqual({ name: "World" });
  });

  it("handles updateDataModel with path", () => {
    const messages: A2UIMessage[] = [
      {
        version: "v0.10",
        createSurface: {
          surfaceId: "s1",
          catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
        },
      },
      {
        version: "v0.10",
        updateDataModel: {
          surfaceId: "s1",
          value: { user: { name: "Alice" } },
        },
      },
      {
        version: "v0.10",
        updateDataModel: {
          surfaceId: "s1",
          path: "/user/role",
          value: "Engineer",
        },
      },
    ];

    const surfaces = processA2UIMessages(messages);
    const data = surfaces.get("s1")!.dataModel as Record<string, Record<string, string>>;
    expect(data.user.name).toBe("Alice");
    expect(data.user.role).toBe("Engineer");
  });

  it("handles deleteSurface", () => {
    const messages: A2UIMessage[] = [
      {
        version: "v0.10",
        createSurface: {
          surfaceId: "s1",
          catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
        },
      },
      {
        version: "v0.10",
        deleteSurface: { surfaceId: "s1" },
      },
    ];

    const surfaces = processA2UIMessages(messages);
    expect(surfaces.size).toBe(0);
  });

  it("processes full dashboard generate → process roundtrip", () => {
    const data = {
      workspace: { id: "w1", title: "My WS", status: "active" },
      sessions: [{ sessionId: "s1", createdAt: new Date().toISOString() }],
      agents: [{ id: "a1", name: "Bot", role: "DEV", status: "ACTIVE" }],
      tasks: [{ id: "t1", title: "Task 1", status: "PENDING", createdAt: new Date().toISOString() }],
      bgTasks: [],
      codebases: [],
      notes: [],
      traces: [],
    };

    const messages = generateDashboardA2UI(data);
    const surfaces = processA2UIMessages(messages);

    // Should have stats + agents + sessions surfaces
    expect(surfaces.size).toBe(3);
    expect(surfaces.has("dashboard_stats")).toBe(true);
    expect(surfaces.has("dashboard_agents")).toBe(true);
    expect(surfaces.has("dashboard_sessions")).toBe(true);
  });
});
