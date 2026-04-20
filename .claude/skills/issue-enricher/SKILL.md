---
name: issue-enricher
description: Transforms rough requirements into well-structured GitHub issues. Use when the user provides a vague idea, feature request, or problem description and wants to create a GitHub issue. Analyzes codebase, explores solution approaches, researches relevant libraries, and generates actionable issues using `gh` CLI.
license: Complete terms in LICENSE.txt
---

## Process

### 1. Understand the Requirement

Extract from user input:
- **Core problem/goal**: What needs to be solved?
- **Mentioned constraints**: Tech stack, performance, compatibility
- **Referenced files/APIs**: `@file.yaml`, existing code paths
- **Related issues**: Links to parent or related issues

If the task is enriching an existing GitHub issue rather than creating a new one:
- Treat `docs/issues/` as the local issue knowledge base when it is available
- Search for mirrored GitHub issues and prior local issue reports before proposing a new direction
- Call out duplicate or related issues explicitly in the output
- For related GitHub issues, inspect associated pull requests and summarize the changed files / diff themes when that context is available

### 2. Codebase Analysis

Search the codebase to understand context:
```
- Existing patterns for similar features
- Related modules and their architecture
- Relevant configuration files
- Test patterns used in the project
- Existing local issue files under docs/issues/ that provide historical context
- Linked PR file changes for related GitHub issues (fetch via gh when needed)
```

When related historical GitHub issues are found, fetch their linked PR context before finalizing the analysis:
```bash
gh issue view <issue-number> --json number,title,url,closedByPullRequestsReferences
gh api repos/<owner>/<repo>/pulls/<pr-number>/files --paginate
```

Summarize:
- changed modules / directories
- key files touched
- test coverage added or updated
- patch themes from the returned `patch` hunks

### 3. Solution Exploration

For each potential approach, research:
- **Libraries/Tools**: Search npm, crates.io, PyPI for relevant packages
- **Trade-offs**: Performance, complexity, maintenance burden
- **Integration effort**: How it fits with existing architecture

Generate 2-3 distinct approaches when multiple solutions exist.

If one requirement actually contains multiple distinct features:
- Split it into multiple issue proposals instead of forcing one umbrella issue
- Keep each issue independently implementable and testable
- Explicitly explain why you split or why you kept items together
- Do not emit search narration or work logs; output final issue drafts only

### 4. Create GitHub Issue

Use `gh issue create` with structured content:

```bash
gh issue create \
  --repo {owner}/{repo} \
  --title "Brief, action-oriented title" \
  --body "$(cat <<'EOF'
# Problem

[1-2 sentences describing the core problem]

## Context

- Current behavior: ...
- Desired behavior: ...
- Related: #issue-number (if applicable)

## Proposed Approaches

### Approach 1: [Name]

**Libraries**: `package-name` (v1.x) - [brief description]

**Pros**:
- ...

**Cons**:
- ...

**Estimated effort**: Small/Medium/Large

### Approach 2: [Name]

...

## Recommendation

[Which approach to start with and why]

## Out of Scope

- [Explicitly excluded items]

## Labels

`enhancement`, `area:...`
EOF
)"
```

## Issue Quality Checklist

- [ ] Title is specific and action-oriented
- [ ] Problem statement is clear without implementation details
- [ ] Each approach has concrete library/tool recommendations
- [ ] Trade-offs are honest (not just pros)
- [ ] Effort estimates are realistic
- [ ] Out of scope is defined to prevent scope creep
- [ ] Links to related issues/PRs included
- [ ] Related History section cites prior issues or explicitly says none were found

## Tips

- **Don't over-specify**: Focus on the problem, not implementation steps
- **Research libraries**: Use web search to find current, maintained options
- **Reference existing code**: Point to patterns already in the codebase
- **Keep it scannable**: Use headers, bullets, and code blocks
- **Label thoughtfully**: Match project's existing label conventions

## Output

Each issue draft must include:
- A `Related History` section citing concrete prior issues or `None found after searching docs/issues/`
- A `Related PR File Context` section when related issues have associated PRs
- A `Recommendation` section choosing one approach
- An `Out of Scope` section
- Final drafts only, no chain-of-thought or search transcript

After creating the issue:
1. Confirm the issue URL
2. Summarize what was created
3. Note any assumptions made that user should verify
