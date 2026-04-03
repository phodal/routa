import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../kanban-page-client.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("kanban page desktop fetch wiring", () => {
  it("uses desktopAwareFetch for page-level data loading and warmup", () => {
    expect(source).toContain("desktopAwareFetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(workspaceId)}`");
    expect(source).toContain("desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`");
    expect(source).toContain("desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`");
    expect(source).toContain("desktopAwareFetch(\n          `/api/specialists?workspaceId=${encodeURIComponent(workspaceId)}&locale=${encodeURIComponent(specialistLanguage)}`");
    expect(source).toContain("desktopAwareFetch(\"/api/acp/warmup\", {");

    expect(source).not.toContain("const res = await fetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(workspaceId)}`");
    expect(source).not.toContain("const res = await fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`");
    expect(source).not.toContain("const res = await fetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`");
    expect(source).not.toContain("const res = await fetch(\n          `/api/specialists?workspaceId=${encodeURIComponent(workspaceId)}&locale=${encodeURIComponent(specialistLanguage)}`");
    expect(source).not.toContain("void fetch(\"/api/acp/warmup\", {");
  });
});
