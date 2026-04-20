export interface IssueEnricherIssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface IssueEnricherSyncContext {
  syncedCount: number;
  currentIssueFile?: string;
}

interface IssueEnricherLabelTaxonomy {
  type: Array<{ name: string }>;
  area: Array<{ name: string }>;
  complexity: Array<{ name: string }>;
}

interface BuildIssueAnalysisPromptOptions {
  dryRun: boolean;
  issue: IssueEnricherIssueData;
  labelTaxonomy: IssueEnricherLabelTaxonomy;
  repo: string;
  syncContext: IssueEnricherSyncContext;
}

function buildLocalIssueContext(syncContext: IssueEnricherSyncContext): string {
  if (syncContext.currentIssueFile) {
    return [
      `- Current issue mirror: \`${syncContext.currentIssueFile}\``,
      `- Synced GitHub issue mirrors available under \`docs/issues/\` (${syncContext.syncedCount} files in this run)`,
    ].join("\n");
  }

  return `- Synced GitHub issue mirrors available under \`docs/issues/\` (${syncContext.syncedCount} files in this run)`;
}

function buildRelatedIssuePrContext(repo: string): string {
  return `## Related Issue PR Context
When you find a related historical GitHub issue in \`docs/issues/\` or GitHub history, you MUST inspect whether it has linked pull requests and summarize the code changes.

Use this flow for each relevant related issue:
1. Read the related issue metadata and resolve its GitHub issue number.
2. Fetch linked PR references:
   - \`gh issue view <issue-number> --repo ${repo} --json number,title,url,closedByPullRequestsReferences\`
3. For each linked PR, fetch changed files and diff hunks:
   - \`gh api repos/${repo}/pulls/<pr-number>/files --paginate\`
4. Summarize the PR file context in your analysis:
   - changed directories or modules
   - notable files touched
   - test files added or updated
   - API, workflow, or runtime surfaces affected
   - patch themes inferred from the returned \`patch\` hunks

If a related issue has no linked PRs, say that explicitly. If the PR is very large, summarize the most relevant files rather than dumping the entire patch.

Your final analysis must include a \`Related PR File Context\` subsection whenever you found related issues with associated PRs.`;
}

export function buildIssueAnalysisPrompt(options: BuildIssueAnalysisPromptOptions): string {
  const { dryRun, issue, labelTaxonomy, repo, syncContext } = options;
  const hasBody = issue.body.trim().length > 0;

  const typeLabels = labelTaxonomy.type.map((label) => `\`${label.name}\``).join(", ");
  const areaLabels = labelTaxonomy.area.map((label) => `\`${label.name}\``).join(", ");
  const complexityLabels = labelTaxonomy.complexity.map((label) => `\`${label.name}\``).join(", ");

  return `Analyze GitHub issue #${issue.number} and provide a detailed analysis.

## Repository
${repo}

## Issue Title
${issue.title}

## Issue Body
${hasBody ? issue.body : "(empty - user did not write a body)"}

## Current Labels
${issue.labels.length > 0 ? issue.labels.join(", ") : "(none)"}

## Local Issue Context
GitHub issues have already been synced into the local \`docs/issues/\` directory before this analysis. Treat those files as your local issue knowledge base.

${buildLocalIssueContext(syncContext)}

Start by reading the mirrored issue file if it exists, then search \`docs/issues/\` for related historical issues, overlapping requirements, duplicate proposals, or prior implementation notes.

${buildRelatedIssuePrContext(repo)}

## CRITICAL: External Repository References
If the issue title or body contains a GitHub repository URL (e.g. https://github.com/user/repo):
- You MUST actually clone the repository using \`git clone <url> /tmp/<repo-name> --depth 1\` via Bash.
- Do NOT just try to fetch the URL via a web reader or guess the repo contents.
- After cloning, explore the repo structure: read its README, key source files, package.json, etc.
- Analyze the cloned repo's architecture, patterns, and features in detail.
- Compare with the current codebase and identify what can be learned or integrated.
- Clean up after: \`rm -rf /tmp/<repo-name>\`

This is essential — if the user says "clone" or references an external repo, the whole point of the issue is to inspect that repo's actual code. Skipping the clone defeats the purpose.

## Instructions
1. Analyze the codebase to understand the context and find relevant files
2. If external repos are referenced, clone and explore them first (see above)
3. Search \`docs/issues/\` and GitHub history for related issues before proposing a solution
4. For every relevant related GitHub issue, fetch linked PR file changes and summarize them (see "Related Issue PR Context")
5. Research potential solution approaches (2-3 approaches with trade-offs)
6. If the issue title is vague or can be improved, ${dryRun ? "output a better title suggestion" : `update it with a clear, action-oriented title that describes what needs to be done: gh issue edit ${issue.number} --title "ACTION: clear description"`}
7. ${!hasBody
    ? (dryRun
        ? "Output the body content you would set (the user wrote no body, so update it directly)"
        : `Since the issue body is empty, update it directly with a detailed description: gh issue edit ${issue.number} --body "CONTENT"`)
    : (dryRun
        ? "Output what you would comment (do NOT actually run gh commands)"
        : `Add a comment to the issue using: gh issue comment ${issue.number} --body "CONTENT"`
      )
  }
8. The ${!hasBody ? "body" : "comment"} should include:
   - Problem analysis
   - Relevant files in the codebase (and external repo if cloned)
   - Related issues or prior context from \`docs/issues/\` and GitHub history
   - Related PR File Context for any related issues with linked PRs
   - 2-3 proposed approaches with trade-offs
   - Recommended approach
   - Effort estimate (Small/Medium/Large)
9. Automatically apply labels based on your analysis using these categories:
   - **Type** (pick ONE): ${typeLabels}
   - **Area** (pick ONE or MORE that apply): ${areaLabels}
   - **Complexity** (pick ONE): ${complexityLabels}
   ${dryRun
     ? "Output the labels you would apply and why, but do NOT run any gh commands."
     : `Apply the labels with: gh issue edit ${issue.number} --add-label "bug,area:frontend,complexity:small" (replace with the labels you chose)
   Use only labels from the taxonomy above. Do NOT invent new label names.`}

Do NOT create a new issue - only analyze and update issue #${issue.number}.`;
}
