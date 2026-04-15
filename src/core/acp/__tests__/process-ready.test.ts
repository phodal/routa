import { describe, expect, it, vi } from "vitest";

import { awaitProcessReady } from "../utils";
import type { IProcessHandle } from "@/core/platform/interfaces";

function createProcessHandle(ready?: Promise<void>): IProcessHandle {
  return {
    pid: 123,
    stdin: null,
    stdout: null,
    stderr: null,
    exitCode: null,
    ready,
    kill: () => {},
    on: () => {},
  };
}

describe("awaitProcessReady", () => {
  it("returns immediately when the backend does not expose a ready promise", async () => {
    await expect(awaitProcessReady(createProcessHandle())).resolves.toBeUndefined();
  });

  it("clears the timeout after the ready promise resolves", async () => {
    vi.useFakeTimers();

    const ready = Promise.resolve();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const pending = awaitProcessReady(createProcessHandle(ready), 25);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeUndefined();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
