import contractJson from "../../../resources/canvas/canvas-generation-contract.json";

export interface CanvasGenerationPromptContract {
  artifactDescription: string;
  requireSourceOnly: boolean;
  allowMarkdownCodeFences: boolean;
  allowProse: boolean;
}

export interface CanvasGenerationOutputContract {
  defaultExportForms: string[];
  jsonSourceKeys: string[];
}

export interface CanvasGenerationImportContract {
  allowedModules: string[];
  normalizedPrefixes: string[];
}

export interface CanvasGenerationRuntimeContract {
  forbiddenGlobals: string[];
}

export interface CanvasGenerationLayoutContract {
  forbiddenShellChrome: string[];
}

export interface CanvasGenerationStyleContract {
  principles: string[];
  forbiddenPatterns: string[];
}

export interface CanvasGenerationStorageContract {
  projectCanvasRoot: string;
}

export interface CanvasGenerationContract {
  schemaVersion: number;
  prompt: CanvasGenerationPromptContract;
  output: CanvasGenerationOutputContract;
  imports: CanvasGenerationImportContract;
  runtime: CanvasGenerationRuntimeContract;
  layout: CanvasGenerationLayoutContract;
  style: CanvasGenerationStyleContract;
  storage: CanvasGenerationStorageContract;
}

const canvasGenerationContract = contractJson as CanvasGenerationContract;

function quote(value: string): string {
  return `\`${value}\``;
}

function formatOrList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

export function getCanvasGenerationContract(): CanvasGenerationContract {
  return canvasGenerationContract;
}

export function buildCanvasSpecialistContractLines(): string[] {
  const contract = getCanvasGenerationContract();
  const lines = [contract.prompt.artifactDescription];

  if (contract.prompt.requireSourceOnly) {
    lines.push("Return only the TSX source.");
  }
  if (!contract.prompt.allowMarkdownCodeFences) {
    lines.push("Do not include markdown code fences.");
  }
  if (!contract.prompt.allowProse) {
    lines.push("Do not include explanations, notes, or prose before or after the code.");
  }

  lines.push(
    `The source must ${formatOrList(contract.output.defaultExportForms.map(quote))}.`,
    "Prefer a self-contained component with inline styles.",
    `If you import anything, you may only import from ${formatOrList(contract.imports.allowedModules.map(quote))}.`,
    `Do not use browser globals or side effects such as ${formatOrList(contract.runtime.forbiddenGlobals.map(quote))}.`,
    `Do not render fake shell chrome such as ${formatOrList(contract.layout.forbiddenShellChrome.map(quote))} unless the prompt explicitly asks for it.`,
    `Keep the composition ${contract.style.principles.join(", ")}; avoid ${contract.style.forbiddenPatterns.join(", ")}.`,
  );

  return lines;
}
