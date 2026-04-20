import type { HistoricalRelatedFile } from "./historical-related-files";

export interface ReviewAnalysisPayload {
  repoPath: string;
  repoRoot: string;
  base: string;
  head: string;
  changedFiles: string[];
  diffStat: string;
  diff: string;
  configSnippets: Array<{ path: string; content: string }>;
  reviewRules?: string;
  graphReviewContext?: unknown;
  historicalRelatedFiles?: HistoricalRelatedFile[];
}
