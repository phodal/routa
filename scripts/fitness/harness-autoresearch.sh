#!/usr/bin/env bash
# harness-autoresearch.sh
#
# pi-autoresearch experiment script for Harness Fitness speed optimization.
# Emits METRIC lines consumed by the pi-autoresearch loop:
#   METRIC fitness_ms=<elapsed_ms>
#   METRIC checks_count=<n>
#   METRIC failed_checks=<n>
#   METRIC top_slowest_ms=<ms_of_slowest_metric>
#   METRIC pass_rate=<0.0-1.0>
#
# Usage:
#   ./scripts/fitness/harness-autoresearch.sh [--tier fast|normal] [--repo-root <path>]
#
# Environment overrides (passed through to entrix):
#   HARNESS_FAST_TIMEOUT_MS    - per-metric timeout in fast mode (ms)
#   HARNESS_PARALLEL_DIMENSIONS - max parallel dimension workers

set -euo pipefail

TIER="fast"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)
      TIER="$2"; shift 2 ;;
    --repo-root)
      REPO_ROOT="$2"; shift 2 ;;
    *)
      shift ;;
  esac
done

# Resolve entrix binary or fall back to cargo runner
if command -v entrix >/dev/null 2>&1; then
  ENTRIX_BIN=("entrix")
else
  ENTRIX_BIN=("cargo" "run" "-q" "-p" "entrix" "--")
fi

SNAPSHOT_PATH="${REPO_ROOT}/docs/fitness/reports/autoresearch-snapshot.json"

# Cross-platform millisecond timestamp (macOS date lacks %N)
now_ms() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(int(time.time()*1000))'
  else
    # Fallback: seconds * 1000 (loses sub-second precision)
    echo "$(( $(date +%s) * 1000 ))"
  fi
}

START_MS=$(now_ms)

# Run entrix and capture JSON output
set +e
RAW_OUTPUT=$(
  cd "${REPO_ROOT}" && \
  "${ENTRIX_BIN[@]}" run \
    --tier "${TIER}" \
    --scope local \
    --json 2>&1
)
EXIT_CODE=$?
set -e

END_MS=$(now_ms)
ELAPSED_MS=$(( END_MS - START_MS ))

# Extract the last JSON object from output
JSON_OUTPUT=$(echo "${RAW_OUTPUT}" | awk '/^\{/{found=1} found{buf=buf $0 "\n"} /^\}/{last=buf; buf=""} END{printf "%s", last}' || true)

if [[ -z "${JSON_OUTPUT}" ]]; then
  echo "METRIC fitness_ms=${ELAPSED_MS}"
  echo "METRIC checks_count=0"
  echo "METRIC failed_checks=0"
  echo "METRIC top_slowest_ms=0"
  echo "METRIC pass_rate=0.0"
  echo "checks_failed=1"
  exit 1
fi

# Save snapshot for regression reference
mkdir -p "$(dirname "${SNAPSHOT_PATH}")"
echo "${JSON_OUTPUT}" > "${SNAPSHOT_PATH}"

# Parse metrics from JSON using python3 (available in most CI/dev envs)
if command -v python3 >/dev/null 2>&1; then
  METRICS=$(echo "${JSON_OUTPUT}" | python3 -c '
import json, sys

elapsed_ms = int(sys.argv[1])
exit_code  = int(sys.argv[2])

try:
    data = json.load(sys.stdin)
except Exception:
    print(f"METRIC fitness_ms={elapsed_ms}")
    print("METRIC checks_count=0")
    print("METRIC failed_checks=0")
    print("METRIC top_slowest_ms=0")
    print("METRIC pass_rate=0.0")
    if exit_code != 0:
        print("checks_failed=1")
    sys.exit(0)

dims = data.get("dimensions", [])
all_metrics = [m for d in dims for m in d.get("metrics", [])]

checks_count   = len(all_metrics)
failed_checks  = sum(1 for m in all_metrics if not m.get("passed", False) and m.get("state", "") not in ["waived"])
passed_checks  = checks_count - failed_checks
pass_rate = round(passed_checks / checks_count, 4) if checks_count > 0 else 0.0

durations = sorted([m.get("duration_ms") or 0 for m in all_metrics], reverse=True)
top_slowest_ms = int(durations[0]) if durations else 0

print(f"METRIC fitness_ms={elapsed_ms}")
print(f"METRIC checks_count={checks_count}")
print(f"METRIC failed_checks={failed_checks}")
print(f"METRIC top_slowest_ms={top_slowest_ms}")
print(f"METRIC pass_rate={pass_rate}")

if exit_code != 0 or data.get("hard_gate_blocked", False):
    print("checks_failed=1")
' "${ELAPSED_MS}" "${EXIT_CODE}")
  echo "${METRICS}"
else
  # Fallback: emit timing only
  echo "METRIC fitness_ms=${ELAPSED_MS}"
  echo "METRIC checks_count=0"
  echo "METRIC failed_checks=0"
  echo "METRIC top_slowest_ms=0"
  echo "METRIC pass_rate=0.0"
  if [[ "${EXIT_CODE}" -ne 0 ]]; then
    echo "checks_failed=1"
  fi
fi

exit "${EXIT_CODE}"
