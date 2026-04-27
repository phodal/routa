import { buildCanvasSpecialistContractLines } from "./generation-contract";
import { buildCanvasSdkPromptSection } from "./sdk-manifest";

export interface LiveCanvasPromptInput {
  repoPath?: string | null;
  request?: string | null;
}

export function buildLiveCanvasAgentPrompt(input: LiveCanvasPromptInput = {}): string {
  const repoPath = input.repoPath?.trim();
  const request = input.request?.trim() || "Create a Routa Canvas for the current work.";

  return [
    "Use Routa Canvas for this turn.",
    "",
    "Canvas behavior:",
    "- Create or overwrite exactly one `*.canvas.tsx` file during the tool run.",
    "- The file content must be the TSX source itself, not markdown.",
    repoPath
      ? `- Prefer storing the file under this repository when appropriate: \`${repoPath}\`.`
      : "- Prefer storing the file under the selected repository when appropriate.",
    "- Use a short descriptive file name ending in `.canvas.tsx`.",
    "- After the file is created, mention the created path briefly.",
    "",
    "Source contract:",
    ...buildCanvasSpecialistContractLines().map((line) => `- ${line}`),
    "",
    buildCanvasSdkPromptSection(),
    "",
    "User request:",
    request,
  ].join("\n");
}
