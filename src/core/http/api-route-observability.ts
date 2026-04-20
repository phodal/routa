import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { NextRequest, NextResponse } from "next/server";

import { getProjectStorageDir } from "@/core/storage/folder-slug";

const DEFAULT_SLOW_API_THRESHOLD_MS = 1_000;
const LOG_FILE_NAME = "slow-api-requests.jsonl";

let writeQueue: Promise<void> = Promise.resolve();

type ApiRouteTimingRecord = {
  timestamp: string;
  route: string;
  method: string;
  pathname: string;
  search: string;
  status: number;
  durationMs: number;
  thresholdMs: number;
};

function slowApiThresholdMs(): number {
  const value = Number(process.env.ROUTA_SLOW_API_THRESHOLD_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SLOW_API_THRESHOLD_MS;
}

function shouldLogAllApiTimings(): boolean {
  return process.env.ROUTA_API_TIMING_LOG_ALL === "1";
}

function slowApiLogPath(): string {
  const runtimeDir = path.join(getProjectStorageDir(process.cwd()), "runtime");
  return path.join(runtimeDir, LOG_FILE_NAME);
}

function enqueueSlowApiRecord(record: ApiRouteTimingRecord): void {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const filePath = slowApiLogPath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
    });

  void writeQueue.catch((error) => {
    console.warn("[api:slow] failed to persist timing", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function attachTimingHeaders(
  response: NextResponse,
  route: string,
  durationMs: number,
): void {
  const durationValue = durationMs.toFixed(1);
  response.headers.set("x-routa-route", route);
  response.headers.set("x-routa-route-duration-ms", durationValue);
  response.headers.append("Server-Timing", `routa-route;dur=${durationValue}`);
}

export async function monitorApiRoute(
  request: NextRequest,
  route: string,
  handler: () => Promise<NextResponse> | NextResponse,
): Promise<NextResponse> {
  const startedAt = performance.now();
  const response = await handler();
  const durationMs = performance.now() - startedAt;
  const thresholdMs = slowApiThresholdMs();
  const shouldRecord = shouldLogAllApiTimings() || durationMs >= thresholdMs;

  attachTimingHeaders(response, route, durationMs);

  if (shouldRecord) {
    const record: ApiRouteTimingRecord = {
      timestamp: new Date().toISOString(),
      route,
      method: request.method,
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      status: response.status,
      durationMs: Math.round(durationMs * 10) / 10,
      thresholdMs,
    };

    console.warn("[api:slow]", record);
    enqueueSlowApiRecord(record);
  }

  return response;
}
