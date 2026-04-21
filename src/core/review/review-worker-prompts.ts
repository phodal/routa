import type { ReviewAnalysisPayload } from "./review-analysis-types";

export type ReviewWorkerType = "context" | "candidates" | "validator";

export function buildReviewWorkerPrompt(params: {
  workerType: ReviewWorkerType;
  payload: ReviewAnalysisPayload;
  contextRaw?: string;
  candidatesRaw?: string;
}): string {
  const payloadJson = JSON.stringify(params.payload, null, 2);

  switch (params.workerType) {
    case "context":
      return [
        "You are acting as the Context Gathering sub-agent for PR review.",
        "This is an internal worker under the top-level PR Reviewer specialist.",
        "Build project review context from this git review payload.",
        "Return strict JSON only.",
        payloadJson,
      ].join("\n\n");
    case "candidates":
      return [
        "You are acting as the Diff Analysis sub-agent for PR review.",
        "This is an internal worker under the top-level PR Reviewer specialist.",
        "Review this change set against the project context below.",
        "Return strict JSON only.",
        "## Project Context",
        params.contextRaw ?? "{}",
        "## Review Payload",
        payloadJson,
      ].join("\n\n");
    case "validator":
      return [
        "You are acting as the Finding Validation sub-agent for PR review.",
        "This is an internal worker under the top-level PR Reviewer specialist.",
        "Filter review candidates using confidence scoring and exclusion rules.",
        "Return strict JSON only.",
        "## Project Context",
        params.contextRaw ?? "{}",
        "## Raw Candidates",
        params.candidatesRaw ?? "{}",
        "## Review Payload",
        payloadJson,
      ].join("\n\n");
  }
}
