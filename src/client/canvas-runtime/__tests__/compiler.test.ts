/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { compileCanvasTsx } from "../compiler";

describe("compileCanvasTsx", () => {
  it("compiles valid TSX with routa/canvas imports", () => {
    const source = `
import React from "react";
import { Stack, H1, Text } from "routa/canvas";

export default function MyCanvas() {
  return (
    <Stack gap={16}>
      <H1>Hello Canvas</H1>
      <Text tone="secondary">Built by an agent</Text>
    </Stack>
  );
}
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.Component).toBe("function");
    }
  });

  it("keeps legacy cursor/canvas imports working", () => {
    const source = `
import { Stack, H1, Text } from "cursor/canvas";

export default function CursorCompatCanvas() {
  return <Stack><H1>Cursor compat</H1><Text>Still supported</Text></Stack>;
}
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
  });

  it("keeps legacy @canvas-sdk imports working", () => {
    const source = `
import { Stack, H1, Text } from "@canvas-sdk";

export default function LegacyCanvas() {
  return <Stack><H1>Legacy</H1><Text>Still supported</Text></Stack>;
}
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
  });

  it("compiles Cursor-compatible hooks, forms, and charts", () => {
    const source = `
import { Stack, TextInput, LineChart, useCanvasState } from "routa/canvas";

export default function MyCanvas() {
  const [query, setQuery] = useCanvasState("query", "");
  return (
    <Stack>
      <TextInput value={query} onChange={setQuery} />
      <LineChart categories={["A", "B"]} series={[{ name: "Score", data: [1, 2] }]} />
    </Stack>
  );
}
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
  });

  it("compiles Cursor-compatible diff and DAG helpers", () => {
    const source = `
import { Card, CardBody, DiffView, computeDAGLayout } from "routa/canvas";

export default function MyCanvas() {
  const layout = computeDAGLayout({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ from: "a", to: "b" }],
  });
  return (
    <Card>
      <CardBody>
        <span>{layout.nodes.length}</span>
        <DiffView path="demo.ts" lines={[{ type: "added", content: "const x = 1;", lineNumber: 1 }]} />
      </CardBody>
    </Card>
  );
}
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
  });

  it("compiles without explicit React import (JSX classic)", () => {
    const source = `
import { H1 } from "@canvas-sdk";
export default function() { return <H1>Hi</H1>; }
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
  });

  it("rejects source without default export", () => {
    const source = `
import { H1 } from "@canvas-sdk";
function MyCanvas() { return <H1>Hi</H1>; }
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("export default");
    }
  });

  it("blocks disallowed imports", () => {
    const source = `
import fs from "fs";
export default function() { fs.readFileSync("/etc/passwd"); return null; }
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"fs" is not allowed');
    }
  });

  it("blocks fetch / window access at import level", () => {
    const source = `
import axios from "axios";
export default function() { return axios.get("/"); }
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"axios" is not allowed');
    }
  });

  it("reports syntax errors from TSX compilation", () => {
    const source = `
export default function() { return <div>unclosed; }
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("TSX compilation failed");
    }
  });

  it("allows @canvas-sdk/* sub-path imports", () => {
    const source = `
import { BarChart } from "@canvas-sdk/charts";
import { Card, CardBody } from "@canvas-sdk/containers";
export default function() {
  return <Card><CardBody><BarChart data={[{label:"A",value:1}]} /></CardBody></Card>;
}
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
  });

  it("accepts local canvas sdk path aliases from generated specialist code", () => {
    const source = `
import type { JSX } from "react";
import { Card, CardBody } from "./client/canvas-sdk/containers";
import { H2, Text } from "@/client/canvas-sdk/primitives";

export default function Canvas(): JSX.Element {
  return (
    <Card>
      <H2>Specialist Canvas</H2>
      <CardBody>
        <Text>Ready for browser use.</Text>
      </CardBody>
    </Card>
  );
}
`;
    const result = compileCanvasTsx(source);
    expect(result.ok).toBe(true);
  });
});
