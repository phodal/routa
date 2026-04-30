import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as getLegacyMemory } from "../route";
import { GET as getSystemMemory } from "../../system/memory/route";

describe("memory API route split", () => {
  it("serves runtime memory stats from the canonical system route", async () => {
    const response = await getSystemMemory(
      new NextRequest("http://localhost/api/system/memory"),
    );
    const body = await response.json();

    expect(response.headers.get("X-Routa-Replacement-Route")).toBeNull();
    expect(body.current).toMatchObject({
      level: expect.any(String),
      heapUsedMB: expect.any(Number),
    });
  });

  it("keeps /api/memory as a deprecated compatibility alias", async () => {
    const response = await getLegacyMemory(
      new NextRequest("http://localhost/api/memory?history=true"),
    );
    const body = await response.json();

    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("X-Routa-Deprecated-Route")).toBe("/api/memory");
    expect(response.headers.get("X-Routa-Replacement-Route")).toBe("/api/system/memory");
    expect(body.current).toMatchObject({
      level: expect.any(String),
      heapUsedMB: expect.any(Number),
    });
    expect(Array.isArray(body.snapshots)).toBe(true);
  });
});
