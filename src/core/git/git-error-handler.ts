/**
 * Git Error Handler
 *
 * Utility for detecting and handling git authentication errors gracefully.
 * Adapted from intent-source/src/shared/git/git-error-handler.ts
 */

// ─── Auth Error Patterns ────────────────────────────────────────────────

const AUTH_ERROR_PATTERNS = [
  /fatal: Authentication failed/i,
  /fatal: could not read Username/i,
  /fatal: could not read Password/i,
  /remote: Invalid username or password/i,
  /Permission denied \(publickey\)/i,
  /Host key verification failed/i,
  /fatal: repository .* not found/i,
  /error: unable to access/i,
  /SSL certificate problem/i,
  /The requested URL returned error: 401/i,
  /The requested URL returned error: 403/i,
  /terminal prompts disabled/i,
];

// ─── Detectors ──────────────────────────────────────────────────────────

export function isSSHAuthError(errorOutput: string): boolean {
  return (
    /Permission denied \(publickey\)/i.test(errorOutput) ||
    /Host key verification failed/i.test(errorOutput)
  );
}

export function isHTTPSAuthError(errorOutput: string): boolean {
  return (
    /fatal: Authentication failed/i.test(errorOutput) ||
    /fatal: could not read Username/i.test(errorOutput) ||
    /fatal: could not read Password/i.test(errorOutput) ||
    /terminal prompts disabled/i.test(errorOutput) ||
    /The requested URL returned error: 40[13]/i.test(errorOutput)
  );
}

export function isGitAuthError(errorOutput: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(errorOutput));
}

export type GitAuthErrorType = "ssh" | "https" | "unknown";

export function getGitAuthErrorType(errorOutput: string): GitAuthErrorType {
  if (isSSHAuthError(errorOutput)) return "ssh";
  if (isHTTPSAuthError(errorOutput)) return "https";
  return "unknown";
}

// ─── User-Facing Messages ───────────────────────────────────────────────

export function getGitAuthErrorMessage(
  errorOutput: string,
  operation: string
): string {
  const errorType = getGitAuthErrorType(errorOutput);

  if (errorType === "ssh") {
    return `Git ${operation} failed: SSH key not configured. Set up SSH keys or switch to HTTPS.`;
  }

  if (/fatal: repository .* not found/i.test(errorOutput)) {
    return `Git ${operation} failed: Repository not found or you don't have access.`;
  }

  if (errorType === "https") {
    return `Git ${operation} failed: Git credentials not configured. Set up a credential manager or use SSH.`;
  }

  return `Git ${operation} failed: Credentials required. Configure SSH keys or a credential manager.`;
}

export interface GitCredentialInstructions {
  title: string;
  description: string;
  steps: string[];
}

export function getGitCredentialSetupInstructions(
  errorType: GitAuthErrorType
): GitCredentialInstructions {
  if (errorType === "ssh") {
    return {
      title: "SSH Key Setup Required",
      description:
        "Git is using SSH but no SSH key is configured. Set up SSH keys or switch to HTTPS.",
      steps: [
        'Generate an SSH key: ssh-keygen -t ed25519 -C "your_email@example.com"',
        'Start the SSH agent: eval "$(ssh-agent -s)"',
        "Add your key: ssh-add ~/.ssh/id_ed25519",
        "Add the public key to GitHub: Settings → SSH and GPG keys → New SSH key",
        "Paste the contents of ~/.ssh/id_ed25519.pub",
      ],
    };
  }

  return {
    title: "Git Credentials Required",
    description:
      "Git needs credentials to access this repository. Set up one of the following:",
    steps: [
      "Option 1: Use Git Credential Manager (recommended for HTTPS)",
      "  - macOS: brew install git-credential-manager",
      "  - Run: git credential-manager configure",
      "  - Next push will prompt for GitHub login",
      "",
      "Option 2: Use SSH keys (recommended for security)",
      "  - Generate key: ssh-keygen -t ed25519",
      "  - Add to GitHub: Settings → SSH and GPG keys",
      "  - Change remote: git remote set-url origin git@github.com:OWNER/REPO.git",
    ],
  };
}

// ─── Generic Git Error Messages ─────────────────────────────────────────

export function getGitErrorMessage(error: string): string {
  const errorLower = error.toLowerCase();

  if (errorLower.includes("permission denied")) {
    return "Permission denied. Please check that you have access to this repository.";
  }
  if (errorLower.includes("not found") || errorLower.includes("enoent")) {
    return "Repository or directory not found. Please check the path.";
  }
  if (errorLower.includes("already exists")) {
    return "A repository with this name already exists.";
  }
  if (errorLower.includes("network") || errorLower.includes("timeout")) {
    return "Network error. Please check your internet connection.";
  }
  if (
    errorLower.includes("authentication") ||
    errorLower.includes("401")
  ) {
    return "Authentication failed. Please check your credentials.";
  }
  if (errorLower.includes("rate limit") || errorLower.includes("403")) {
    return "API rate limit exceeded or access denied. Please try again later.";
  }
  if (errorLower.includes("disk space") || errorLower.includes("enospc")) {
    return "Insufficient disk space. Please free up some space.";
  }

  return error;
}

// ─── Wrapper for auth-safe operations ───────────────────────────────────

export interface GitOperationResult<T> {
  success: boolean;
  data?: T;
  authRequired?: boolean;
  error?: string;
  errorType?: GitAuthErrorType;
}

export async function withGitAuthHandling<T>(
  operation: string,
  fn: () => Promise<T> | T
): Promise<GitOperationResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const stderr =
      (error as { stderr?: string })?.stderr || errorMessage;

    if (isGitAuthError(stderr) || isGitAuthError(errorMessage)) {
      const userMessage = getGitAuthErrorMessage(
        stderr || errorMessage,
        operation
      );
      return {
        success: false,
        authRequired: true,
        error: userMessage,
        errorType: getGitAuthErrorType(stderr || errorMessage),
      };
    }

    return {
      success: false,
      error: getGitErrorMessage(errorMessage),
    };
  }
}
