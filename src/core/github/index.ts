export {
  importGitHubRepo,
  getCachedWorkspace,
  cleanupExpired,
  listActiveWorkspaces,
  workspaceKey,
  GitHubWorkspaceError,
} from "./github-workspace";

export type {
  GitHubImportOptions,
  GitHubWorkspace,
  VirtualFileEntry,
  GitHubWorkspaceErrorCode,
} from "./github-workspace";

export {
  postPRComment,
  postPRReview,
  getPRFiles,
  getPRDetails,
} from "./github-pr-comment";

export type {
  PostPRCommentOptions,
  PostPRReviewOptions,
} from "./github-pr-comment";


export {
  findDuplicateCandidates,
  syncGitHubIssues,
  loadSyncedGitHubIssues,
  defaultIssueCachePath,
} from "./github-issue-intel";

export type {
  GitHubIssueRecord,
  DuplicateCandidate,
} from "./github-issue-intel";
