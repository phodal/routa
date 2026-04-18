/**
 * VCS Module Exports
 */

export type {
  VCSPlatform,
  VCSRepository,
  VCSPullRequest,
  VCSBranch,
  VCSComment,
  VCSFileChange,
  VCSWebhookPayload,
  IVCSProvider,
} from "./vcs-provider";

export {
  GitHubProvider,
} from "./github-provider";

export {
  GitLabProvider,
} from "./gitlab-provider";

export {
  getVCSProvider,
  resetVCSProvider,
  getPlatform,
  isGitLab,
  isGitHub,
} from "./vcs-provider";
