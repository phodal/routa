/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerDetector } from "../detector";

const {
  execMock,
  whichMock,
  spawnMock,
  statSyncMock,
  osPlatformMock,
} = vi.hoisted(() => ({
  execMock: vi.fn(),
  whichMock: vi.fn(),
  spawnMock: vi.fn(),
  statSyncMock: vi.fn(),
  osPlatformMock: vi.fn(() => "linux"),
}));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    env: {
      osPlatform: osPlatformMock,
    },
    fs: {
      statSync: statSyncMock,
    },
    process: {
      exec: execMock,
      spawn: spawnMock,
    },
  }),
}));

vi.mock("@/core/acp/utils", () => ({
  which: whichMock,
}));

describe("DockerDetector", () => {
  beforeEach(() => {
    execMock.mockReset();
    whichMock.mockReset();
    spawnMock.mockReset();
    statSyncMock.mockReset();
    osPlatformMock.mockReset();
    osPlatformMock.mockReturnValue("linux");
    whichMock.mockResolvedValue(null);
  });

  it("returns available status when docker info succeeds", async () => {
    execMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ ServerVersion: "27.3.1", ClientInfo: { ApiVersion: "1.47" } }),
      stderr: "",
    });

    const detector = new DockerDetector();
    const result = await detector.checkAvailability(true);

    expect(result.available).toBe(true);
    expect(result.daemonRunning).toBe(true);
    expect(result.version).toBe("27.3.1");
    expect(result.apiVersion).toBe("1.47");
  });

  it("returns unavailable status when docker command fails", async () => {
    execMock.mockRejectedValueOnce(new Error("docker: command not found"));

    const detector = new DockerDetector();
    const result = await detector.checkAvailability(true);

    expect(result.available).toBe(false);
    expect(result.daemonRunning).toBe(false);
    expect(result.error).toContain("docker: command not found");
  });

  it("uses cached availability result within ttl", async () => {
    execMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ ServerVersion: "27.3.1", ClientInfo: { ApiVersion: "1.47" } }),
      stderr: "",
    });

    const detector = new DockerDetector();
    const first = await detector.checkAvailability(false);
    const second = await detector.checkAvailability(false);

    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("forces refresh when forceRefresh=true", async () => {
    execMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ServerVersion: "27.3.1", ClientInfo: { ApiVersion: "1.47" } }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ServerVersion: "27.4.0", ClientInfo: { ApiVersion: "1.48" } }),
        stderr: "",
      });

    const detector = new DockerDetector();
    const first = await detector.checkAvailability(false);
    const second = await detector.checkAvailability(true);

    expect(first.version).toBe("27.3.1");
    expect(second.version).toBe("27.4.0");
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("checks Windows install paths using platform fs flags", async () => {
    osPlatformMock.mockReturnValue("win32");
    statSyncMock.mockImplementation((path: string) => ({
      isDirectory: false,
      isFile: path === "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    }));

    spawnMock.mockImplementation(() => ({
      stdout: {
        on: (event: string, handler: (chunk: Buffer) => void) => {
          if (event === "data") {
            handler(Buffer.from(JSON.stringify({ ServerVersion: "27.5.1" })));
          }
        },
      },
      stderr: {
        on: (_event: string, _handler: (chunk: Buffer) => void) => {},
      },
      on: (event: string, handler: (code?: number) => void) => {
        if (event === "exit") {
          setTimeout(() => handler(0), 0);
        }
      },
      kill: vi.fn(),
    }));

    const detector = new DockerDetector();
    const result = await detector.checkAvailability(true);

    expect(result.available).toBe(true);
    expect(result.version).toBe("27.5.1");
    expect(spawnMock).toHaveBeenCalledWith(
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      ["info", "--format", "{{json .}}"],
    );
  });

  it("preserves short ASCII docker errors when sanitizing", async () => {
    execMock.mockRejectedValueOnce(new Error("dial tcp: EOF"));

    const detector = new DockerDetector();
    const result = await detector.checkAvailability(true);

    expect(result.error).toBe("dial tcp: EOF");
  });
});
