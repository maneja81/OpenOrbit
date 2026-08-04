#!/usr/bin/env bash
#
# Run the Playwright E2E suite in a throwaway worktree, so a build/install failure or a stray
# write can never touch this checkout or the real ~/Library/Application Support/OpenOrbit
# database. Copies .env.test from the main OpenOrbit checkout in as the E2E worktree's .env,
# builds and runs the suite there, writes a markdown report back into this worktree, then
# removes the throwaway worktree — pass or fail.
#
# Usage: scripts/run-e2e-isolated.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_CHECKOUT="/Users/mohitaneja/Projects/OpenOrbit"
ENV_TEST="$MAIN_CHECKOUT/.env.test"
BRANCH="$(git -C "$HERE" branch --show-current)"

if [[ -z "$BRANCH" ]]; then
  echo "ERROR: HEAD is detached in $HERE — run this from a worktree on a named branch." >&2
  exit 1
fi

# git worktree add only sees committed state. Uncommitted changes here would silently be
# absent from the isolated run, which reads as "tests passed" against stale code.
if [[ -n "$(git -C "$HERE" status --porcelain)" ]]; then
  echo "ERROR: $HERE has uncommitted changes. Commit or stash before running the isolated E2E suite." >&2
  exit 1
fi

if [[ ! -f "$ENV_TEST" ]]; then
  echo "ERROR: $ENV_TEST not found — nothing to copy into the isolated worktree." >&2
  exit 1
fi

RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
WORKTREE_PATH="$MAIN_CHECKOUT/.claude/worktrees/e2e-run-$RUN_ID"
REPORT_DIR="$HERE/e2e/reports/$RUN_ID"

cleanup() {
  if [[ -d "$WORKTREE_PATH" ]]; then
    echo "removing isolated worktree: $WORKTREE_PATH"
    git -C "$MAIN_CHECKOUT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || rm -rf "$WORKTREE_PATH"
  fi
}
trap cleanup EXIT

echo "branch:            $BRANCH"
echo "isolated worktree:  $WORKTREE_PATH"
echo "report directory:   $REPORT_DIR"
echo

# --detach: the source branch is already checked out in $HERE, and git refuses to check out
# the same branch in two worktrees at once.
git -C "$MAIN_CHECKOUT" worktree add --detach "$WORKTREE_PATH" "$BRANCH"

cp "$ENV_TEST" "$WORKTREE_PATH/.env"

pushd "$WORKTREE_PATH" >/dev/null

echo "== npm install =="
npm install

# Documented gotcha: npm ci/install regularly leaves Electron half-installed while exiting 0.
if [[ ! -f node_modules/electron/path.txt || ! -d node_modules/electron/dist ]]; then
  echo "== repairing Electron binary =="
  rm -rf node_modules/electron/dist node_modules/electron/path.txt
  node node_modules/electron/install.js
fi

echo "== npm run build =="
npm run build

echo "== playwright test =="
RESULTS_JSON="$WORKTREE_PATH/e2e-results.json"
set +e
node --env-file-if-exists=.env node_modules/.bin/playwright test -c e2e/playwright.config.ts --reporter=json > "$RESULTS_JSON"
TEST_EXIT=$?
set -e

popd >/dev/null

mkdir -p "$REPORT_DIR"
cp "$RESULTS_JSON" "$REPORT_DIR/results.json"

set +e
node "$HERE/scripts/format-e2e-report.mjs" "$REPORT_DIR/results.json" "$REPORT_DIR/report.md"
REPORT_EXIT=$?
set -e

echo
echo "report: $REPORT_DIR/report.md"
cat "$REPORT_DIR/report.md"

if [[ $TEST_EXIT -ne 0 ]]; then
  echo
  echo "playwright exited non-zero ($TEST_EXIT) — see report above." >&2
  exit "$TEST_EXIT"
fi
exit "$REPORT_EXIT"
