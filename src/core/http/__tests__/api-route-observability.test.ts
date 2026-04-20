import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toFolderSlug } from "@/core/storage/folder-slug";
import { monitorApiRoute } from "../api-route-observability";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

describe("monitorApiRoute", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-route-observability-"));
    process.chdir(tempDir);
    process.env.HOME = tempDir;
    process.env.ROUTA_SLOW_API_THRESHOLD_MS = "0";
  });

  afterEach(async () => {
    process.chdir(ORIGINAL_CWD);
    process.env = { ...ORIGINAL_ENV };
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("adds route timing headers and records slow route timings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = new NextRequest("http://localhost/api/tasks?workspaceId=default");

    const response = await monitorApiRoute(
      request,
      "GET /api/tasks",
      () => NextResponse.json({ ok: true }),
    );

    expect(response.headers.get("x-routa-route")).toBe("GET /api/tasks");
    expect(response.headers.get("x-routa-route-duration-ms")).toMatch(/^\d+\.\d$/);
    expect(response.headers.get("Server-Timing")).toContain("routa-route");

    const logPath = path.join(
      tempDir,
      ".routa",
      "projects",
      toFolderSlug(process.cwd()),
      "runtime",
      "slow-api-requests.jsonl",
    );

    await vi.waitFor(async () => {
      const log = await fs.readFile(logPath, "utf8");
      const record = JSON.parse(log.trim());

      expect(record).toMatchObject({
        route: "GET /api/tasks",
        method: "GET",
        pathname: "/api/tasks",
        search: "?workspaceId=default",
        status: 200,
        thresholdMs: 0,
      });
      expect(record.durationMs).toEqual(expect.any(Number));
    });

    expect(warn).toHaveBeenCalledWith("[api:slow]", expect.objectContaining({
      route: "GET /api/tasks",
    }));
  });
});
