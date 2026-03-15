export type ReviewSeverity = "CRITICAL" | "WARNING" | "SUGGESTION";
export type ReviewVerdict = "KEEP" | "REJECT";

export interface RawReviewFinding {
  file: string;
  line: number;
  category: string;
  severity: ReviewSeverity;
  rawConfidence: number;
  description: string;
  suggestion: string;
  concreteEvidence?: boolean;
}

export interface ReviewContext {
  linterCoveredCategories?: string[];
}

export interface ValidatedReviewFinding extends RawReviewFinding {
  validatedConfidence: number;
  verdict: ReviewVerdict;
  reasoning: string;
}

const STYLE_CATEGORY_KEYWORDS = [
  "style",
  "format",
  "naming",
  "lint",
  "typescript type",
];

const FRAMEWORK_HANDLED_KEYWORDS = [
  "xss",
  "body parsing",
  "next.js api",
  "react",
  "framework",
  "dangerouslysetinnerhtml",
];

const NON_ACTIONABLE_KEYWORDS = [
  "theoretical",
  "speculative",
  "could potentially",
  "might",
  "possible",
];

const TODO_KEYWORDS = ["todo", "fixme", "hack"];
const LOGGING_KEYWORDS = ["logging", "audit trail", "telemetry"];

const clampConfidence = (value: number): number => Math.max(1, Math.min(10, Math.round(value)));

export const isTestFile = (filePath: string): boolean =>
  /(\/|^)(test|tests|__tests__|e2e)(\/|$)/i.test(filePath) || /\.(test|spec)\.[a-z]+$/i.test(filePath);

export function validateReviewFinding(
  finding: RawReviewFinding,
  context: ReviewContext = {},
): ValidatedReviewFinding {
  const normalizedCategory = finding.category.toLowerCase();
  const normalizedDescription = finding.description.toLowerCase();
  const normalizedSuggestion = finding.suggestion.toLowerCase();

  const isMissingValidationInTestFile =
    isTestFile(finding.file) &&
    (normalizedCategory.includes("validation") ||
      normalizedDescription.includes("missing error handling") ||
      normalizedDescription.includes("missing input validation"));

  if (isMissingValidationInTestFile) {
    return {
      ...finding,
      verdict: "REJECT",
      validatedConfidence: 3,
      reasoning: "Test file finding about validation/error handling is an explicit hard exclusion.",
    };
  }

  const linterCovered =
    STYLE_CATEGORY_KEYWORDS.some((keyword) => normalizedCategory.includes(keyword)) ||
    (context.linterCoveredCategories ?? []).some((covered) =>
      normalizedCategory.includes(covered.toLowerCase()),
    );

  if (linterCovered) {
    return {
      ...finding,
      verdict: "REJECT",
      validatedConfidence: 4,
      reasoning: "Style/formatting/type finding is likely covered by linting and should be filtered out.",
    };
  }

  const isFrameworkHandled = FRAMEWORK_HANDLED_KEYWORDS.some(
    (keyword) => normalizedDescription.includes(keyword) || normalizedSuggestion.includes(keyword),
  );

  if (isFrameworkHandled && !normalizedDescription.includes("dangerouslysetinnerhtml")) {
    return {
      ...finding,
      verdict: "REJECT",
      validatedConfidence: 3,
      reasoning: "Potential issue appears framework-handled without concrete unsafe usage.",
    };
  }

  if (TODO_KEYWORDS.some((k) => normalizedDescription.includes(k))) {
    return {
      ...finding,
      verdict: "REJECT",
      validatedConfidence: 2,
      reasoning: "TODO/FIXME/HACK-only findings are intentionally excluded.",
    };
  }

  if (LOGGING_KEYWORDS.some((k) => normalizedDescription.includes(k))) {
    return {
      ...finding,
      verdict: "REJECT",
      validatedConfidence: 3,
      reasoning: "Missing logging/audit findings are excluded by design.",
    };
  }

  let validatedConfidence = finding.rawConfidence;

  if (NON_ACTIONABLE_KEYWORDS.some((k) => normalizedDescription.includes(k))) {
    validatedConfidence -= 3;
  }

  if (finding.concreteEvidence) {
    validatedConfidence += 2;
  }

  const clamped = clampConfidence(validatedConfidence);

  return {
    ...finding,
    verdict: clamped >= 7 ? "KEEP" : "REJECT",
    validatedConfidence: clamped,
    reasoning:
      clamped >= 7
        ? "Finding is concrete, actionable, and passes the confidence threshold."
        : "Finding confidence is below threshold or too speculative for high-signal review output.",
  };
}

export function filterValidatedFindings(
  findings: RawReviewFinding[],
  context: ReviewContext = {},
): ValidatedReviewFinding[] {
  return findings
    .map((finding) => validateReviewFinding(finding, context))
    .filter((finding) => finding.verdict === "KEEP");
}
