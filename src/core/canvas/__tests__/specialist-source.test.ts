import { describe, expect, it } from "vitest";

import {
  buildCanvasSpecialistPrompt,
  extractCanvasSourceFromSpecialistOutput,
} from "../specialist-source";

describe("canvas specialist source helpers", () => {
  it("builds a constrained canvas prompt", () => {
    const prompt = buildCanvasSpecialistPrompt("Create a status card.");

    expect(prompt).toContain("Return only the TSX source");
    expect(prompt).toContain("Create a status card.");
  });

  it("extracts TSX from fenced code blocks", () => {
    const source = extractCanvasSourceFromSpecialistOutput(`
Here is the component:

\`\`\`tsx
export default function Canvas() {
  return <div>Hello</div>;
}
\`\`\`
`);

    expect(source).toContain("export default function Canvas()");
    expect(source).toContain("<div>Hello</div>");
  });

  it("extracts TSX from json payloads", () => {
    const source = extractCanvasSourceFromSpecialistOutput(JSON.stringify({
      source: "export default function Canvas(){ return <div>JSON</div>; }",
    }));

    expect(source).toBe("export default function Canvas(){ return <div>JSON</div>; }");
  });

  it("upgrades bare Canvas function declarations", () => {
    const source = extractCanvasSourceFromSpecialistOutput(`
function Canvas() {
  return <div>Ready</div>;
}
`);

    expect(source).toContain("export default function Canvas()");
  });

  it("returns null when no canvas component can be recovered", () => {
    expect(extractCanvasSourceFromSpecialistOutput("I cannot do that.")).toBeNull();
  });
});
