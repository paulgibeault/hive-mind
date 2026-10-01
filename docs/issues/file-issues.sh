#!/usr/bin/env bash
# File docs/issues/01..13 as GitHub issues #1..#13 (in order), then 00-index as a
# tracking issue. Needs `gh` signed in. Run from the repo root:
#   bash docs/issues/file-issues.sh
# Already run on 2026-09-28 (#1–#14). It refuses to run if the repo has any issues.
set -euo pipefail
cd "$(dirname "$0")"
repo="paulgibeault/hive-mind"

if [ -n "$(gh issue list --repo "$repo" --state all --limit 1 --json number -q '.[].number')" ]; then
  echo "$repo already has issues; refusing to file duplicates." >&2
  exit 1
fi

file_one() {  # $1 = markdown file
  local title body
  title="$(head -n1 "$1" | sed 's/^# *//')"
  # drop the H1; turn "#01" style refs into real issue refs "#1"
  body="$(tail -n +2 "$1" | sed -E 's/#0([0-9])([^0-9]|$)/#\1\2/g')"
  gh issue create --repo "$repo" --title "$title" --body "$body"
}

for f in 0[1-9]-*.md 1[0-9]-*.md; do
  echo "→ $f"
  file_one "$f"
done
echo "→ 00-index.md (tracking issue)"
file_one 00-index.md
