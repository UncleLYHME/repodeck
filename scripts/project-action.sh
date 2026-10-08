#!/usr/bin/env bash
# Local dev actions for repodeck: setup, start, check, test, lint, build.
# Backs the T3 project action buttons (via ~/.codex/bin/project-action) and runs directly too.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
    cat <<'EOF'
Usage: scripts/project-action.sh [--dry-run] <setup|start|check|test|lint|build> [args...]

  setup  Install locked dependencies
  start  Run the local dev app
  check  Fast readiness checks without starting anything
  test   Run the test suite
  lint   Run linters and static validators
  build  Build frontend assets

Extra args go to the underlying command (e.g. a test label). --dry-run prints commands only.
EOF
}

DRY_RUN=0
if [[ ${1:-} == --dry-run || ${1:-} == -n ]]; then DRY_RUN=1; shift; fi
ACTION=${1:-}
[[ -n $ACTION && $ACTION != -h && $ACTION != --help ]] || { usage; exit 0; }
shift
ARGS=""
(($# == 0)) || ARGS=" $(printf '%q ' "$@")"

run() {
    local cmd="$*"
    printf '+ %s\n' "$cmd"
    ((DRY_RUN)) || eval "$cmd"
}

case "$ACTION" in
    setup) run "pnpm install --frozen-lockfile" ;;
    start) run "pnpm dev$ARGS" ;;
    check | lint) run "pnpm typecheck" ;;
    test) run "pnpm test$ARGS" ;;
    build) run "pnpm build" ;;
    *) printf 'Unknown action: %s\n\n' "$ACTION" >&2; usage >&2; exit 2 ;;
esac
