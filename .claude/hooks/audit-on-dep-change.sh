#!/usr/bin/env bash
# PostToolUse (Bash) hook — dependency-change security alert.
#
# After any npm command that can alter the dependency tree/lockfile, run
# `npm audit` and, if HIGH or CRITICAL advisories are present, surface a
# non-blocking alert. It never fails the command and never auto-fixes —
# it only tells you (and Claude) that the advisory picture changed.
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

# `npm audit` works from package-lock.json alone (no node_modules needed).
audit_json="$(npm audit --json 2>/dev/null)" || true
[ -n "$audit_json" ] || exit 0

high="$(printf '%s' "$audit_json" \
  | jq -r '((.metadata.vulnerabilities.high // 0) + (.metadata.vulnerabilities.critical // 0))' 2>/dev/null || echo 0)"

if [ "${high:-0}" -gt 0 ] 2>/dev/null; then
  list="$(printf '%s' "$audit_json" | jq -r '
    .vulnerabilities | to_entries[]
    | select(.value.severity == "high" or .value.severity == "critical")
    | "  - \(.key) (\(.value.severity)): \(.value.via[0].title? // "see npm audit")"' 2>/dev/null | head -15)"
  msg="npm audit: ${high} high/critical advisory(ies) after a dependency change:
${list}

Review with \`npm audit\`; \`npm audit fix\` remediates. (Alert only — nothing was changed.)"
  jq -n --arg m "$msg" '{
    "systemMessage": $m,
    "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": $m }
  }'
fi
exit 0
