import * as yaml from "js-yaml";
import { extractCanonicalStoryYaml } from "./canonical-story";
import type { InvestValidation } from "../models/task";

const INVEST_LABELS = {
  independent: "Independent",
  negotiable: "Negotiable",
  valuable: "Valuable",
  estimable: "Estimable",
  small: "Small",
  testable: "Testable",
} as const;

type InvestKey = keyof typeof INVEST_LABELS;

const MARKDOWN_SECTION_NAMES = [
  "Summary",
  "Objective",
  "Description",
  "Problem Statement",
  "User Value",
  "Acceptance Criteria",
  "Acceptance",
  "Definition of Done",
  "Dependencies",
  "Dependency Plan",
  "Prerequisites",
  "Scope",
  "Constraints",
] as const;

interface ObjectiveSignals {
  summary: string;
  problemStatement: string;
  userValue: string;
  acceptanceCriteria: string[];
  dependencyNotes: string[];
  scopeNotes: string[];
  wordCount: number;
  hasCanonicalYaml: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidStatus(value: unknown): value is "pass" | "fail" | "warning" {
  return value === "pass" || value === "fail" || value === "warning";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function extractMarkdownSection(content: string, names: readonly string[]): string {
  const allNamesPattern = MARKDOWN_SECTION_NAMES.map(escapeRegExp).join("|");

  for (const name of names) {
    const pattern = new RegExp(
      String.raw`(?:^|\n)(?:#{1,6}\s*|\*\*)?${escapeRegExp(name)}(?:\*\*)?\s*:?\s*\n([\s\S]*?)(?=(?:\n(?:#{1,6}\s*|\*\*)?(?:${allNamesPattern})(?:\*\*)?\s*:?\s*\n)|$)`,
      "i",
    );
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function extractBulletItems(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

function getLeadingParagraph(content: string): string {
  return content
    .replace(/```yaml[\s\S]*?```/gi, "")
    .split(/\n#{1,6}\s+|\n\*\*.+?\*\*\s*\n/g)[0]
    ?.trim() ?? "";
}

function loadObjectiveRoot(objective: string | null | undefined): Record<string, unknown> | null {
  const rawYaml = extractCanonicalStoryYaml(objective);
  if (!rawYaml) {
    return null;
  }

  try {
    const parsed = yaml.load(rawYaml);
    return isRecord(parsed) && isRecord(parsed.story) ? parsed.story : null;
  } catch {
    return null;
  }
}

function readStoryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStoryStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (isRecord(item) && typeof item.text === "string") return item.text.trim();
      return "";
    })
    .filter(Boolean);
}

function extractObjectiveSignals(objective: string | null | undefined): ObjectiveSignals {
  const content = (objective ?? "").trim();
  const storyRoot = loadObjectiveRoot(objective);
  const summarySection = extractMarkdownSection(content, ["Summary", "Objective", "Description"]);
  const problemStatementSection = extractMarkdownSection(content, ["Problem Statement"]);
  const userValueSection = extractMarkdownSection(content, ["User Value"]);
  const acceptanceSection = extractMarkdownSection(content, [
    "Acceptance Criteria",
    "Acceptance",
    "Definition of Done",
  ]);
  const dependenciesSection = extractMarkdownSection(content, ["Dependencies", "Dependency Plan", "Prerequisites"]);
  const scopeSection = extractMarkdownSection(content, ["Scope", "Constraints"]);

  const storyDependencies = isRecord(storyRoot?.dependencies_and_sequencing)
    ? storyRoot.dependencies_and_sequencing
    : null;

  const dependencyNotes = [
    ...readStoryStringArray(storyDependencies?.depends_on),
    readStoryString(storyDependencies?.unblock_condition),
    ...extractBulletItems(dependenciesSection),
  ].map((item) => item.trim()).filter(Boolean);

  const acceptanceCriteria = [
    ...readStoryStringArray(storyRoot?.acceptance_criteria),
    ...extractBulletItems(acceptanceSection),
  ].filter(Boolean);

  const scopeNotes = [
    ...readStoryStringArray(storyRoot?.constraints_and_affected_areas),
    ...extractBulletItems(scopeSection),
  ].filter(Boolean);

  const problemStatement = readStoryString(storyRoot?.problem_statement) || normalizeWhitespace(problemStatementSection);
  const userValue = readStoryString(storyRoot?.user_value) || normalizeWhitespace(userValueSection);
  const summary = readStoryString(storyRoot?.title)
    || normalizeWhitespace(summarySection)
    || normalizeWhitespace(getLeadingParagraph(content));

  return {
    summary,
    problemStatement,
    userValue,
    acceptanceCriteria,
    dependencyNotes,
    scopeNotes,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    hasCanonicalYaml: Boolean(storyRoot),
  };
}

function classifyStatus(
  status: InvestValidation["overall"],
  reason: string,
): { status: InvestValidation["overall"]; reason: string } {
  return { status, reason };
}

function containsPattern(values: string[], pattern: RegExp): boolean {
  return values.some((value) => pattern.test(value));
}

function hasVagueAcceptanceCriteria(acceptanceCriteria: string[]): boolean {
  return acceptanceCriteria.some((criterion) =>
    /\b(works?(?:\s+(?:correctly|well))?|appropriate|properly|intuitive|user-friendly|robust|as expected|etc\.?)\b/i.test(criterion)
  );
}

function evaluateIndependent(signals: ObjectiveSignals): InvestValidation["independent"] {
  const dependencyText = signals.dependencyNotes.join(" ");
  if (dependencyText && /\b(blocked by|depends on|waiting for|after\b|prerequisite)\b/i.test(dependencyText)
    && !/\b(no dependencies|none|n\/a|independent|can start now|not blocked)\b/i.test(dependencyText)) {
    return classifyStatus("fail", "Blocking or prerequisite work is still declared.");
  }

  if (
    containsPattern(signals.dependencyNotes, /\b(no dependencies|none|n\/a|independent|can start now|not blocked)\b/i)
    || (signals.hasCanonicalYaml && signals.dependencyNotes.length === 0)
  ) {
    return classifyStatus("pass", "No blocking dependencies are declared.");
  }

  return classifyStatus("warning", "No explicit dependency plan proves the story is independent.");
}

function evaluateNegotiable(signals: ObjectiveSignals): InvestValidation["negotiable"] {
  const rigidityText = [signals.summary, signals.problemStatement, ...signals.scopeNotes].join(" ");
  if (/\b(must use|exactly|only|hardcode|strictly|do not change anything else)\b/i.test(rigidityText)) {
    return classifyStatus("fail", "Story is overly implementation-prescriptive and leaves little room for negotiation.");
  }

  return classifyStatus("warning", "Story is actionable, but negotiability still depends on team discussion.");
}

function evaluateValuable(signals: ObjectiveSignals): InvestValidation["valuable"] {
  if (signals.problemStatement && signals.userValue) {
    return classifyStatus("pass", "Problem statement and user value are both explicit.");
  }

  if (signals.summary && signals.acceptanceCriteria.length > 0) {
    return classifyStatus("warning", "Outcome is described, but the user or business value remains implicit.");
  }

  if (/\b(so that|so teams can|to enable|to allow|to reduce|to improve|user|customer|business|team)\b/i.test(
    [signals.summary, signals.problemStatement, signals.userValue].join(" "),
  )) {
    return classifyStatus("warning", "Outcome is described, but the value statement is still implicit.");
  }

  return classifyStatus("fail", "Story does not clearly explain why this work matters.");
}

function evaluateEstimable(signals: ObjectiveSignals): InvestValidation["estimable"] {
  if (signals.acceptanceCriteria.length >= 2 && (signals.scopeNotes.length > 0 || signals.wordCount <= 260)) {
    return classifyStatus("pass", "Acceptance criteria and scope are concrete enough to estimate.");
  }

  if (signals.acceptanceCriteria.length >= 1 || signals.summary.length >= 40) {
    return classifyStatus("warning", "There is enough context to start discussion, but estimation is still fuzzy.");
  }

  return classifyStatus("fail", "Story lacks enough detail to estimate effort confidently.");
}

function evaluateSmall(signals: ObjectiveSignals): InvestValidation["small"] {
  const broadScope = /\b(end-to-end|across the stack|multiple systems|large refactor|platform-wide)\b/i.test(
    [signals.summary, signals.problemStatement, ...signals.scopeNotes].join(" "),
  );

  if (signals.wordCount > 450 || signals.acceptanceCriteria.length > 6) {
    return classifyStatus("fail", "Story appears too large for a single focused iteration.");
  }

  if (signals.wordCount > 240 || signals.acceptanceCriteria.length > 4 || broadScope) {
    return classifyStatus("warning", "Scope may still need trimming before implementation.");
  }

  return classifyStatus("pass", "Scope looks focused enough for a single iteration.");
}

function evaluateTestable(signals: ObjectiveSignals): InvestValidation["testable"] {
  if (signals.acceptanceCriteria.length === 0) {
    return classifyStatus("fail", "No explicit acceptance criteria or verification checks were provided.");
  }

  if (hasVagueAcceptanceCriteria(signals.acceptanceCriteria)) {
    return classifyStatus("warning", "Some acceptance criteria use vague wording that is hard to verify objectively.");
  }

  return classifyStatus("pass", "Acceptance criteria are concrete enough to verify objectively.");
}

function buildHeuristicValidation(
  objective: string | null | undefined,
  validatedAt = new Date().toISOString(),
): InvestValidation | undefined {
  const signals = extractObjectiveSignals(objective);
  if (!signals.summary && !signals.problemStatement && signals.acceptanceCriteria.length === 0) {
    return undefined;
  }

  const validation = {
    independent: evaluateIndependent(signals),
    negotiable: evaluateNegotiable(signals),
    valuable: evaluateValuable(signals),
    estimable: evaluateEstimable(signals),
    small: evaluateSmall(signals),
    testable: evaluateTestable(signals),
  };

  return {
    ...validation,
    overall: computeOverallStatus(validation),
    validatedAt,
    issues: collectIssues(validation),
  };
}

function computeOverallStatus(validation: Omit<InvestValidation, "overall" | "validatedAt" | "issues">): InvestValidation["overall"] {
  const statuses = [
    validation.independent.status,
    validation.negotiable.status,
    validation.valuable.status,
    validation.estimable.status,
    validation.small.status,
    validation.testable.status,
  ];

  if (statuses.includes("fail")) {
    return "fail";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  return "pass";
}

function collectIssues(validation: Omit<InvestValidation, "overall" | "validatedAt" | "issues">): string[] {
  return (Object.entries(INVEST_LABELS) as [InvestKey, string][])
    .flatMap(([key, label]) => {
      const check = validation[key];
      return check.status === "pass" ? [] : [`${label}: ${check.reason}`];
    });
}

export function deriveInvestValidationFromObjective(
  objective: string | null | undefined,
  validatedAt = new Date().toISOString(),
): InvestValidation | undefined {
  const rawYaml = extractCanonicalStoryYaml(objective);
  if (!rawYaml) {
    return buildHeuristicValidation(objective, validatedAt);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(rawYaml);
  } catch {
    return buildHeuristicValidation(objective, validatedAt);
  }

  if (!isRecord(parsed) || !isRecord(parsed.story) || !isRecord(parsed.story.invest)) {
    return buildHeuristicValidation(objective, validatedAt);
  }

  const invest = parsed.story.invest;
  const validation = {} as Omit<InvestValidation, "overall" | "validatedAt" | "issues">;

  for (const key of Object.keys(INVEST_LABELS) as InvestKey[]) {
    const value = invest[key];
    if (!isRecord(value) || !isValidStatus(value.status) || typeof value.reason !== "string" || !value.reason.trim()) {
      return undefined;
    }
    validation[key] = {
      status: value.status,
      reason: value.reason.trim(),
    };
  }

  return {
    ...validation,
    overall: computeOverallStatus(validation),
    validatedAt,
    issues: collectIssues(validation),
  };
}

export function resolveInvestValidation(params: {
  objective: string | null | undefined;
  provided?: InvestValidation;
  keepExisting?: InvestValidation;
}): InvestValidation | undefined {
  if (params.provided) {
    return params.provided;
  }

  const derived = deriveInvestValidationFromObjective(params.objective);
  if (derived) {
    return derived;
  }

  return params.objective === undefined ? params.keepExisting : undefined;
}
