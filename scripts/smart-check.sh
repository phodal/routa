#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Smart Pre-Push Check Script
# ═══════════════════════════════════════════════════════════════════════════════
#
# Runs lint and tests before push. On failure:
#   - In AI agent environment → Output clear error message for AI to fix
#   - In human environment → Optionally auto-fix with claude -p
#
# Usage:
#   ./scripts/smart-check.sh           # Run checks
#   ./scripts/smart-check.sh --fix     # Run checks, auto-fix on failure (human mode)
#
# Environment variables for AI detection:
#   CLAUDE_CODE=1, ANTHROPIC_AGENT=1, AUGMENT_AGENT=1, CURSOR_AGENT=1,
#   GITHUB_ACTIONS=1, CI=1, ROUTA_AGENT=1
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ─── AI Agent Detection ─────────────────────────────────────────────────────

is_ai_agent() {
  # Check common AI agent environment variables
  # Note: CLAUDE_CODE_SSE_PORT is set by Augment but doesn't mean we're in AI mode
  # We need to check for the actual CLAUDE_CODE variable (without suffix)
  if [[ "$CLAUDE_CODE" == "1" ]] || \
     [[ -n "$ANTHROPIC_AGENT" ]] || \
     [[ -n "$AUGMENT_AGENT" ]] || \
     [[ -n "$CURSOR_AGENT" ]] || \
     [[ -n "$ROUTA_AGENT" ]] || \
     [[ -n "$AIDER_AGENT" ]] || \
     [[ -n "$COPILOT_AGENT" ]] || \
     [[ -n "$WINDSURF_AGENT" ]] || \
     [[ -n "$CLINE_AGENT" ]]; then
    return 0
  fi

  # Check if running in CI (GitHub Actions, etc.)
  if [[ -n "$GITHUB_ACTIONS" ]] || [[ -n "$CI" ]]; then
    return 0
  fi

  # Check if parent process is an AI agent (heuristic)
  # Claude Code spawns processes with specific patterns
  if [[ -n "$CLAUDE_CONFIG_DIR" ]] || [[ -n "$MCP_SERVER_NAME" ]]; then
    return 0
  fi

  return 1
}

# ─── Temp Files for Output Capture ──────────────────────────────────────────

LINT_LOG=$(mktemp)
TYPECHECK_LOG=$(mktemp)
TEST_LOG=$(mktemp)

cleanup() {
  rm -f "$LINT_LOG" "$TYPECHECK_LOG" "$TEST_LOG"
}
trap cleanup EXIT

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  local auto_fix=false
  local fail_fast=true  # Default to fail-fast mode

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --fix) auto_fix=true; shift ;;
      --no-fail-fast) fail_fast=false; shift ;;
      *) shift ;;
    esac
  done

  local lint_exit=0 typecheck_exit=0 test_exit=0

  # ─── Run Lint ─────────────────────────────────────────────────────────────
  echo -e "${BLUE}[1/3] Running lint...${NC}"
  echo ""
  set +e
  npm run lint 2>&1 | tee "$LINT_LOG"
  lint_exit=${PIPESTATUS[0]}
  set -e
  echo ""
  if [[ $lint_exit -eq 0 ]]; then
    echo -e "${GREEN}✓ Lint passed${NC}"
  else
    echo -e "${RED}✗ Lint failed (exit code: $lint_exit)${NC}"
    if [[ "$fail_fast" == true ]]; then
      handle_failure "$auto_fix" "lint" $lint_exit 0 0
      exit 1
    fi
  fi
  echo ""

  # ─── Run Type Check ───────────────────────────────────────────────────────
  echo -e "${BLUE}[2/3] Running type check...${NC}"
  echo ""
  set +e
  npx tsc --noEmit 2>&1 | tee "$TYPECHECK_LOG"
  typecheck_exit=${PIPESTATUS[0]}
  set -e

  # Check if the error is due to stale .next types
  if [[ $typecheck_exit -ne 0 ]] && grep -q "\.next/types/.*Cannot find module.*src/app/.*page\.js" "$TYPECHECK_LOG"; then
    echo -e "${YELLOW}⚠ Detected stale .next types. Cleaning and retrying...${NC}"
    rm -rf .next
    echo ""
    set +e
    npx tsc --noEmit 2>&1 | tee "$TYPECHECK_LOG"
    typecheck_exit=${PIPESTATUS[0]}
    set -e
  fi

  echo ""
  if [[ $typecheck_exit -eq 0 ]]; then
    echo -e "${GREEN}✓ Type check passed${NC}"
  else
    echo -e "${RED}✗ Type check failed (exit code: $typecheck_exit)${NC}"
    if [[ "$fail_fast" == true ]]; then
      handle_failure "$auto_fix" "typecheck" $lint_exit $typecheck_exit 0
      exit 1
    fi
  fi
  echo ""

  # ─── Run Tests ────────────────────────────────────────────────────────────
  echo -e "${BLUE}[3/3] Running tests...${NC}"
  echo ""
  set +e
  npm run test -- --run 2>&1 | tee "$TEST_LOG"
  test_exit=${PIPESTATUS[0]}
  set -e
  echo ""
  if [[ $test_exit -eq 0 ]]; then
    echo -e "${GREEN}✓ Tests passed${NC}"
  else
    echo -e "${RED}✗ Tests failed (exit code: $test_exit)${NC}"
    if [[ "$fail_fast" == true ]]; then
      handle_failure "$auto_fix" "test" $lint_exit $typecheck_exit $test_exit
      exit 1
    fi
  fi
  echo ""

  # All passed?
  if [[ $lint_exit -eq 0 ]] && [[ $typecheck_exit -eq 0 ]] && [[ $test_exit -eq 0 ]]; then
    maybe_warn_human_review
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  All checks passed! Ready to push.${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    exit 0
  fi

  # ─── Failure Handling (only reached in --no-fail-fast mode) ───────────────
  handle_failure "$auto_fix" "all" $lint_exit $typecheck_exit $test_exit
  exit 1
}

# ─── Review Trigger Warning ─────────────────────────────────────────────────
maybe_warn_human_review() {
  local review_base="HEAD~1"

  if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    review_base='@{upstream}'
  fi

  echo -e "${BLUE}[review] Evaluating human review triggers...${NC}"
  echo ""
  PYTHONPATH=tools/entrix python3 -m entrix.cli review-trigger --base "$review_base" || true
  echo ""
}

# ─── Failure Handler ─────────────────────────────────────────────────────────
handle_failure() {
  local auto_fix="$1"
  local failed_step="$2"
  local lint_exit="$3"
  local typecheck_exit="$4"
  local test_exit="$5"

  echo ""
  echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
  case "$failed_step" in
    lint)      echo -e "${RED}  ✗ LINT FAILED${NC}" ;;
    typecheck) echo -e "${RED}  ✗ TYPE CHECK FAILED${NC}" ;;
    test)      echo -e "${RED}  ✗ TESTS FAILED${NC}" ;;
    *)         echo -e "${RED}  Pre-push checks failed!${NC}" ;;
  esac
  echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
  echo ""

  # Check if we're in an AI agent environment
  if is_ai_agent; then
    echo -e "${YELLOW}Running in AI agent environment.${NC}"
    echo -e "${YELLOW}Please fix the errors shown above.${NC}"
    exit 1
  fi

  # Check if claude CLI is available
  if ! command -v claude &> /dev/null; then
    echo -e "${YELLOW}Claude CLI not found. Please fix errors manually.${NC}"
    exit 1
  fi

  if [[ "$auto_fix" == true ]]; then
    echo -e "${BLUE}Auto-fix mode enabled. Starting Claude...${NC}"
  else
    echo -e "${YELLOW}Would you like Claude to fix these issues? [y/N]${NC}"
    read -r -t 30 response || response="n"
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
      echo "Aborted. Please fix errors manually."
      exit 1
    fi
  fi

  # Build the fix prompt using captured log files
  local fix_prompt="Pre-push checks failed. Please fix the following issues:\n\n"

  if [[ $lint_exit -ne 0 ]]; then
    fix_prompt+="## Lint Errors\n\`\`\`\n$(cat "$LINT_LOG" | tail -100)\n\`\`\`\n\n"
  fi

  if [[ $typecheck_exit -ne 0 ]]; then
    fix_prompt+="## Type Check Errors\n\`\`\`\n$(cat "$TYPECHECK_LOG" | tail -100)\n\`\`\`\n\n"
  fi

  if [[ $test_exit -ne 0 ]]; then
    fix_prompt+="## Test Failures\n\`\`\`\n$(cat "$TEST_LOG" | tail -100)\n\`\`\`\n\n"
  fi

  fix_prompt+="After fixing all issues, run the checks again to verify, then push the changes."

  echo -e "${BLUE}Starting Claude to fix issues...${NC}"
  echo ""

  # Run claude with the fix prompt
  claude -p "$fix_prompt"

  echo ""
  echo -e "${GREEN}Claude has attempted to fix the issues.${NC}"
  echo -e "${YELLOW}Please review the changes and run 'git push' again.${NC}"
  exit 1
}

main "$@"
