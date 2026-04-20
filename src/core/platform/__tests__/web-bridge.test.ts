import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebPlatformBridge } from "../web-bridge";

describe("WebPlatformBridge", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-bridge-test-"));
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.NETLIFY;
    delete process.env.FUNCTION_NAME;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
      statusText: "OK",
    })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses filesystem helpers against the local node environment", async () => {
    const bridge = new WebPlatformBridge();
    const nestedDir = path.join(tempDir, "nested");
    const filePath = path.join(nestedDir, "note.txt");

    await bridge.fs.mkdir(nestedDir, { recursive: true });
    await bridge.fs.writeTextFile(filePath, "hello");

    expect(await bridge.fs.exists(filePath)).toBe(true);
    expect(bridge.fs.existsSync(filePath)).toBe(true);
    expect(await bridge.fs.readTextFile(filePath)).toBe("hello");
    expect(bridge.fs.readTextFileSync(filePath)).toBe("hello");
    expect(await bridge.fs.stat(filePath)).toEqual({
      isDirectory: false,
      isFile: true,
    });
    expect(bridge.fs.readDirSync(tempDir)).toEqual([
      expect.objectContaining({
        name: "nested",
        isDirectory: true,
      }),
    ]);
  });

  it("disables process and terminal access in serverless mode", () => {
    process.env.VERCEL = "1";
    const bridge = new WebPlatformBridge();

    expect(bridge.env.isServerless()).toBe(true);
    expect(bridge.process.isAvailable()).toBe(false);
    expect(bridge.terminal.isAvailable()).toBe(false);
    expect(() => bridge.process.execSync("pwd")).toThrow(
      "Process execution is not available in serverless environments",
    );
    expect(() => bridge.process.spawn("git", ["status"])).toThrow(
      "Process spawning is not available in serverless environments",
    );
  });

  it("supports event dispatch, shell/dialog fallbacks, and invoke", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    const bridge = new WebPlatformBridge();
    const stop = bridge.events.listen("agent:update", handler);

    await bridge.events.emit("agent:update", { id: 1 });
    stop();
    await bridge.events.emit("agent:update", { id: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: 1 });
    expect(await bridge.dialog.open()).toBeNull();
    expect(await bridge.dialog.save()).toBeNull();
    expect(await bridge.dialog.message("hi")).toBe(0);
    await bridge.shell.openUrl("https://example.com");
    await bridge.shell.openPath("/tmp/file");
    expect(warn).toHaveBeenCalled();

    expect(await bridge.invoke("ping", { hello: "world" })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(bridge.env.isDesktop()).toBe(false);
    expect(bridge.env.isTauri()).toBe(false);
    expect(bridge.env.isElectron()).toBe(false);
    expect(bridge.env.currentDir()).toBe(process.cwd());
    expect(bridge.env.osPlatform()).toBe(process.platform);
  });
});
