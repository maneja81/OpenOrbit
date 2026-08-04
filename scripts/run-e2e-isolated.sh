#!/usr/bin/env bash
#
# Run the Playwright E2E suite in a throwaway worktree, so a build/install failure or a stray
# write can never touch this checkout or the real ~/Library/Application Support/OpenOrbit
# database. Copies .env.test from the main OpenOrbit checkout in as the E2E worktree's .env,
# builds and runs the suite there, writes a markdown report back into this worktree, then
# removes the throwaway worktree — pass or fail.
#
# Usage:
#   scripts/run-e2e-isolated.sh              # run every spec under e2e/
#   scripts/run-e2e-isolated.sh onboarding   # forwarded to `playwright test` as a name filter
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The main checkout is always the first entry `git worktree list` reports, from any worktree —
# no hardcoded path, so this works from any clone location on any machine.
MAIN_CHECKOUT="$(git -C "$HERE" worktree list --porcelain | head -1 | cut -d' ' -f2-)"
ENV_TEST="$MAIN_CHECKOUT/.env.test"
BRANCH="$(git -C "$HERE" branch --show-current)"

# node_modules cache, keyed by package-lock.json content — outside .claude/worktrees/ so it is
# never mistaken for a worktree, and already covered by .gitignore's blanket `.claude/*`.
CACHE_ROOT="$MAIN_CHECKOUT/.claude/.e2e-npm-cache"
KEEP_REPORTS=10

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

LOCK_HASH="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
CACHE_DIR="$CACHE_ROOT/$LOCK_HASH"

if [[ -d "$CACHE_DIR/node_modules" ]]; then
  echo "== restoring node_modules from cache ($LOCK_HASH) =="
  # -c: APFS clonefile — instant, copy-on-write, and safe: a build process editing a file here
  # forks a private copy at the filesystem level rather than mutating the shared cache.
  cp -c -R "$CACHE_DIR/node_modules" node_modules
else
  echo "== npm install (no cache for $LOCK_HASH) =="
  npm install
  echo "== populating node_modules cache =="
  mkdir -p "$CACHE_DIR"
  cp -c -R node_modules "$CACHE_DIR/node_modules"
fi

# Documented gotcha: npm ci/install regularly leaves Electron half-installed while exiting 0.
# Cheap enough to check unconditionally, cache hit or not.
if [[ ! -f node_modules/electron/path.txt || ! -d node_modules/electron/dist ]]; then
  echo "== repairing Electron binary =="
  rm -rf node_modules/electron/dist node_modules/electron/path.txt
  node node_modules/electron/install.js
  # A repaired binary belongs in the cache too, or every future run repeats the repair.
  rm -rf "$CACHE_DIR/node_modules"
  cp -c -R node_modules "$CACHE_DIR/node_modules"
fi

echo "== npm run build =="
npm run build

echo "== playwright test =="
RESULTS_JSON="$WORKTREE_PATH/e2e-results.json"
set +e
node --env-file-if-exists=.env node_modules/.bin/playwright test -c e2e/playwright.config.ts --reporter=json "$@" > "$RESULTS_JSON"
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

# Keep only the newest KEEP_REPORTS report directories. Built-in macOS bash is 3.2 (no mapfile),
# so this reads the list the same way, one path at a time, rather than into an array.
PRUNE_COUNT=0
while IFS= read -r old_dir; do
  [[ -z "$old_dir" ]] && continue
  rm -rf "$old_dir"
  PRUNE_COUNT=$((PRUNE_COUNT + 1))
done < <(ls -1dt "$HERE"/e2e/reports/*/ 2>/dev/null | tail -n "+$((KEEP_REPORTS + 1))")
if [[ $PRUNE_COUNT -gt 0 ]]; then
  echo "pruned $PRUNE_COUNT old report(s), kept the newest $KEEP_REPORTS"
fi

if [[ $TEST_EXIT -ne 0 ]]; then
  echo
  echo "playwright exited non-zero ($TEST_EXIT) — see report above." >&2
  exit "$TEST_EXIT"
fi
exit "$REPORT_EXIT"
