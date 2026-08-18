#!/usr/bin/env bash
# PostToolUse (Bash) hook — dependency-change security alert.
#
# After any npm command that can alter the dependency tree/lockfile, run the
# shared advisory gate (scripts/check-advisories.sh) and, if a HIGH/CRITICAL
# advisory that is NOT allowlisted appears, surface a non-blocking alert. It
# never fails the command and never auto-fixes — it only reports that the
# advisory picture changed. Allowlisted advisories (.github/audit-allowlist.txt)
# are excluded so accepted, no-fix-available items don't nag.
#
# Reads the PostToolUse payload as JSON on stdin: { tool_input: { command } }.
set -uo pipefail

payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)"

# React only to dependency-mutating npm subcommands (subcommand must follow
# `npm` directly, so `npm test`/`npm run …` never trip it). `npm audit fix`
# is included so a partial fix that leaves highs behind still alerts.
dep_re='npm[[:space:]]+(install|i|add|ci|update|up|remove|rm|uninstall|dedupe)([[:space:]]|$)'
fix_re='npm[[:space:]]+audit[[:space:]]+fix'
if ! printf '%s' "$cmd" | grep -Eq "($dep_re|$fix_re)"; then
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
findings="$(bash "$script_dir/../../scripts/check-advisories.sh" 2>/dev/null)"
rc=$?

if [ "$rc" -ne 0 ] && [ -n "$findings" ]; then
  msg="npm audit: unaccepted high/critical advisory(ies) after a dependency change:
$(printf '%s' "$findings" | sed 's/^/  - /')

Review with \`npm audit\`; \`npm audit fix\` remediates. Accepted items in
.github/audit-allowlist.txt are excluded. (Alert only — nothing was changed.)"
  jq -n --arg m "$msg" '{
    "systemMessage": $m,
    "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": $m }
  }'
fi
exit 0
