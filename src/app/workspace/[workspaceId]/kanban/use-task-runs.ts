"use client";

import { useEffect, useState } from "react";
import type { TaskRunInfo } from "../types";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export function useTaskRuns(taskId: string, refreshKey?: string | number) {
  const [runs, setRuns] = useState<TaskRunInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        setError(null);
        const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}/runs`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            typeof payload?.error === "string" ? payload.error : `Failed to load task runs (${response.status})`,
          );
        }

        const payload = await response.json() as { runs?: TaskRunInfo[] };
        setRuns(Array.isArray(payload.runs) ? payload.runs : []);
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setError(nextError instanceof Error ? nextError.message : "Failed to load task runs");
        setRuns(null);
      }
    })();

    return () => controller.abort();
  }, [taskId, refreshKey]);

  return { runs, error };
}
