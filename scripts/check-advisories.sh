#!/usr/bin/env bash
# Allowlist-aware npm advisory gate. Reports HIGH/CRITICAL advisories from
# `npm audit`, excluding any GHSA id justified in .github/audit-allowlist.txt.
#
# Shared by the CI "Security audit" job and the local dependency hook so both
# honor the same documented exceptions.
#
#   stdout : one line per actionable (non-allowlisted) high/critical advisory
#   stderr : informational notes for allowlisted-but-present advisories
#   exit   : 1 if any non-allowlisted high/critical remains, else 0
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
allow_file="$repo_root/.github/audit-allowlist.txt"
ghsa_re='GHSA-[a-z0-9]+(-[a-z0-9]+)+'

accepted=""
if [ -f "$allow_file" ]; then
  # Bare id lines only — comment mentions (starting with #) don't count.
  accepted="$(grep -vE '^[[:space:]]*#' "$allow_file" | grep -oE "$ghsa_re" | sort -u)"
fi

audit_json="$(cd "$repo_root" && npm audit --json 2>/dev/null)" || true
if [ -z "$audit_json" ]; then
  echo "check-advisories: npm audit produced no output" >&2
  exit 0
fi

# Every GHSA id attached to a high/critical advisory object. Use a while-read
# loop (not `mapfile`) so this works on macOS's bundled bash 3.2.
all_ids=()
while IFS= read -r id; do
  [ -n "$id" ] && all_ids+=("$id")
done < <(printf '%s' "$audit_json" \
  | jq -r '[.vulnerabilities[]? | select(.severity=="high" or .severity=="critical") | .via[]? | objects | .url] | .[]' 2>/dev/null \
  | grep -oE "$ghsa_re" | sort -u)

status=0
for id in "${all_ids[@]:-}"; do
  [ -n "$id" ] || continue
  desc="$(printf '%s' "$audit_json" | jq -r --arg u "$id" \
    '[.vulnerabilities[]?.via[]? | objects | select(.url // "" | test($u)) | "\(.name) (\(.severity)): \(.title)"] | .[0] // $u' 2>/dev/null)"
  if printf '%s\n' "$accepted" | grep -qxF "$id"; then
    echo "accepted (allowlisted): $desc [$id]" >&2
  else
    echo "$desc [$id]"
    status=1
  fi
done
exit $status
