#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
# Run fitness checks in a Docker container (similar to GitHub Actions)
#
# Usage:
#   ./scripts/fitness-docker.sh              # Run all fitness checks
#   ./scripts/fitness-docker.sh --build      # Force rebuild image
#   ./scripts/fitness-docker.sh --shell      # Drop into shell for debugging
#   ./scripts/fitness-docker.sh npm run lint  # Run specific command
# ═══════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="entrix"

cd "$PROJECT_ROOT"

# Parse flags
BUILD_FLAG=""
SHELL_MODE=""
CUSTOM_CMD=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --build)
            BUILD_FLAG="1"
            shift
            ;;
        --shell)
            SHELL_MODE="1"
            shift
            ;;
        *)
            CUSTOM_CMD+=("$1")
            shift
            ;;
    esac
done

# Build image if needed or --build flag
if [[ -n "$BUILD_FLAG" ]] || ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
    echo "🔨 Building fitness Docker image..."
    docker build \
        -f docker/Dockerfile.fitness \
        -t "$IMAGE_NAME" \
        .
    echo ""
fi

# Run
if [[ -n "$SHELL_MODE" ]]; then
    echo "🐚 Dropping into shell..."
    docker run --rm -it "$IMAGE_NAME" /bin/bash
elif [[ ${#CUSTOM_CMD[@]} -gt 0 ]]; then
    docker run --rm "$IMAGE_NAME" "${CUSTOM_CMD[@]}"
else
    docker run --rm "$IMAGE_NAME"
fi
