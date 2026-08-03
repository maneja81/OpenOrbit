#!/usr/bin/env bash
#
# Copy this project into a self-contained folder, skipping regenerable and
# machine-local files.
#
# Usage:
#   scripts/copy-to-openorbit.sh [dest]     # default: <repo>/OpenOrbit
#   scripts/copy-to-openorbit.sh --dry-run  # show what would be copied
#   scripts/copy-to-openorbit.sh --no-history   # omit .git (fresh start)
#   scripts/copy-to-openorbit.sh --force    # allow a non-empty dest
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=""
DRY_RUN=0
FORCE=0
WITH_HISTORY=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=1 ;;
    --force)      FORCE=1 ;;
    --no-history) WITH_HISTORY=0 ;;
    -h|--help)    sed -n '3,11p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*)           echo "unknown option: $1" >&2; exit 2 ;;
    *)            DEST="$1" ;;
  esac
  shift
done

DEST="${DEST:-$SRC/OpenOrbit}"
# Resolve without requiring the path to exist yet.
DEST="$(cd "$(dirname "$DEST")" && pwd)/$(basename "$DEST")"

if [[ "$DEST" == "$SRC" ]]; then
  echo "refusing to copy the project onto itself: $DEST" >&2
  exit 1
fi

if [[ -e "$DEST" && -n "$(ls -A "$DEST" 2>/dev/null)" && $FORCE -eq 0 ]]; then
  echo "destination exists and is not empty: $DEST" >&2
  echo "re-run with --force to copy into it anyway." >&2
  exit 1
fi

# Regenerable output, caches, machine-local state, and secrets. Anchored paths
# (leading /) are relative to the project root; bare names match at any depth.
EXCLUDES=(
  "node_modules/"
  "/dist-electron/"
  "/dist/"
  "/build/"
  "/release/"
  "/coverage/"
  "*.tsbuildinfo"
  ".DS_Store"
  "/.claude/worktrees/"
  "/0-cowork/reference/"
  ".playwright-mcp/"
  ".devswarm-temp/"
  ".env"
  ".env.*"
  "*.pem"
)

# Guard against recursion when the destination lives inside the source tree.
case "$DEST" in
  "$SRC"/*) EXCLUDES+=("/${DEST#"$SRC"/}") ;;
esac

[[ $WITH_HISTORY -eq 1 ]] || EXCLUDES+=("/.git/")

RSYNC_ARGS=(-a)
[[ $DRY_RUN -eq 1 ]] && RSYNC_ARGS+=(-n -v)
for pattern in "${EXCLUDES[@]}"; do
  RSYNC_ARGS+=(--exclude "$pattern")
done

echo "source:      $SRC"
echo "destination: $DEST"
echo "history:     $([[ $WITH_HISTORY -eq 1 ]] && echo "included (.git)" || echo "omitted")"
[[ $DRY_RUN -eq 1 ]] && echo "mode:        dry run (nothing will be written)"
echo

mkdir -p "$DEST"
rsync "${RSYNC_ARGS[@]}" "$SRC/" "$DEST/"

if [[ $DRY_RUN -eq 1 ]]; then
  echo
  echo "Dry run complete — no files were written."
  exit 0
fi

echo "Copied $(find "$DEST" -type f -not -path '*/.git/*' | wc -l | tr -d ' ') files ($(du -sh "$DEST" | cut -f1))."
echo
echo "Next steps:"
echo "  cd \"$DEST\""
echo "  npm install     # rebuilds native modules via electron-builder install-app-deps"
echo "  npm run dev"
echo
echo "Not copied (intentionally): node_modules, build output, *.tsbuildinfo,"
echo ".DS_Store, .claude/worktrees, 0-cowork/reference, and .env* files."
echo "The .env.bak in the source holds live-looking API keys — move those through"
echo "a password manager and rotate them rather than copying the file."
