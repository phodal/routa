---
name: canvas
description: Create or update a Routa Canvas artifact for the current task. Use when the user wants a live visual or interactive canvas generated from a Routa session.
metadata:
  short-description: Create a Routa Canvas artifact
---

Use Routa Canvas for this turn.

Canvas behavior:
- Create or overwrite exactly one `*.canvas.tsx` file during the tool run.
- The file content must be the TSX source itself, not markdown.
- Prefer storing the file under the selected repository when appropriate.
- Use a short descriptive file name ending in `.canvas.tsx`.
- After the file is created, mention the created path briefly.

Source contract:
- Create a Routa browser canvas as TSX source code.
- Return only the TSX source.
- Do not include markdown code fences.
- Do not include explanations, notes, or prose before or after the code.
- The source must `export default function Canvas()` or `export default Canvas`.
- Prefer a self-contained component with inline styles.
- If you import anything, you may only import from `react`, `routa/canvas`, `routa/canvas/*`, `@canvas-sdk`, or `@canvas-sdk/*`.
- Do not use browser globals or side effects such as `window`, `document`, `fetch`, or `localStorage`.
- Do not render fake shell chrome such as `browser frames`, `global app shells`, `left sidebars`, or `chat panes` unless the prompt explicitly asks for it.
- Keep the composition flat, minimal, purposeful; avoid gradients, emojis, box shadows.

Canvas SDK access:
- Prefer MCP tool `read_canvas_sdk_resource` with uri `resource://routa/canvas-sdk/manifest`.
- If your provider supports native MCP resource reads, you may read that same URI directly instead.
- That manifest is the authoritative Canvas SDK index for this session.
- Then read only the defs resources you actually need from its `definitionResources` list, preferably through `read_canvas_sdk_resource`.
- Import only from `routa/canvas` or `react`.
- If a symbol or prop is not present in those resources, do not invent it.
- Example definition resources:
- `resource://routa/canvas-sdk/defs/primitives`
- `resource://routa/canvas-sdk/defs/hooks`
- `resource://routa/canvas-sdk/defs/data-display`
- `resource://routa/canvas-sdk/defs/containers`
- `resource://routa/canvas-sdk/defs/controls`
- `resource://routa/canvas-sdk/defs/charts`
- `resource://routa/canvas-sdk/defs/diff-view`
- `resource://routa/canvas-sdk/defs/dag-layout`
- If neither direct resource reads nor the helper tool are available, stay conservative and use only the symbols named in the manifest.
