#!/usr/bin/env bash
# recap.sh — "where did we leave off?" briefing for this project.
#
# Pulls together, for the current git repo:
#   - current branch + recent commits
#   - uncommitted work (what's in flight right now)
#   - the most recent prompts you typed, merged across Claude Code and agy
#     (Antigravity), so you can jog your memory across parallel projects.
#
# It prints plain text. The Claude /recap command and the SessionStart hook
# (and agy's AGENTS.md) feed this output to the model to narrate.
#
# Usage: recap.sh [--exclude-session <id>]

set -euo pipefail

EXCLUDE_SESSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --exclude-session) EXCLUDE_SESSION="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

# Resolve repo root so the script works from any cwd inside the repo.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
REPO_NAME="$(basename "$REPO_ROOT")"

printf '═══ Recap: %s ═══   (%s)\n\n' "$REPO_NAME" "$(date '+%a %b %d, %Y %-I:%M %p')"

# ── Git state ───────────────────────────────────────────────────────────────
if git rev-parse --git-dir >/dev/null 2>&1; then
  printf '▸ Branch: %s\n\n' "$(git branch --show-current 2>/dev/null || echo '(detached)')"

  printf '▸ Recent commits:\n'
  git log -8 --pretty=format:'  %h  %s  (%cr)' 2>/dev/null || echo '  (none)'
  printf '\n\n'

  CHANGES="$(git status --short 2>/dev/null || true)"
  if [ -n "$CHANGES" ]; then
    N="$(printf '%s\n' "$CHANGES" | grep -c . || true)"
    printf '▸ Uncommitted work (%s):\n' "$N"
    printf '%s\n' "$CHANGES" | head -15 | sed 's/^/  /'
    [ "$N" -gt 15 ] && printf '  … and %s more\n' "$((N-15))"
    printf '\n'
  else
    printf '▸ Working tree clean.\n\n'
  fi
fi

# ── Recent prompts, merged across tools ─────────────────────────────────────
printf '▸ What you were working on (most recent first):\n'

REPO_NAME="$REPO_NAME" EXCLUDE_SESSION="$EXCLUDE_SESSION" python3 - <<'PY'
import json, os, glob, time

repo = os.environ["REPO_NAME"]
exclude = os.environ.get("EXCLUDE_SESSION", "")
home = os.path.expanduser("~")
now = time.time()
items = []  # (epoch, tool, text)

def ago(epoch):
    s = max(0, now - epoch)
    if s < 90:        return "just now"
    if s < 3600:      return f"{int(s//60)}m ago"
    if s < 86400:     return f"{int(s//3600)}h ago"
    return f"{int(s//86400)}d ago"

def clean(t):
    t = " ".join(str(t).split())
    return t[:110] + ("…" if len(t) > 110 else "")

def noise(t):
    if not t or len(t.strip()) < 2:
        return True
    head = t.lstrip()
    for m in ("<command-", "<local-command", "<system-reminder",
              "Caveat:", "[Request interrupted", "<bash-"):
        if head.startswith(m):
            return True
    return False

# agy / Antigravity: flat prompt log tagged with workspace + ms timestamp.
agy_hist = os.path.join(home, ".gemini/antigravity-cli/history.jsonl")
if os.path.exists(agy_hist):
    for line in open(agy_hist, errors="ignore"):
        try:
            o = json.loads(line)
        except Exception:
            continue
        ws = o.get("workspace", "")
        if os.path.basename(ws.rstrip("/")) != repo:
            continue
        txt = o.get("display", "")
        if noise(txt):
            continue
        items.append((o.get("timestamp", 0) / 1000.0, "agy", clean(txt)))

# Claude Code: per-session JSONL transcripts. Scan all projects, match by cwd.
for f in glob.glob(os.path.join(home, ".claude/projects/*/*.jsonl")):
    for line in open(f, errors="ignore"):
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("type") != "user":
            continue
        if exclude and o.get("sessionId") == exclude:
            continue
        if os.path.basename((o.get("cwd") or "").rstrip("/")) != repo:
            continue
        c = o.get("message", {}).get("content")
        if not isinstance(c, str) or noise(c):
            continue
        ts = o.get("timestamp", "")
        try:
            epoch = time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
            # transcript timestamps are UTC; shift to local epoch
            epoch -= time.timezone if not time.localtime().tm_isdst else time.altzone
        except Exception:
            epoch = 0
        items.append((epoch, "claude", clean(c)))

items.sort(key=lambda x: x[0], reverse=True)

# Drop consecutive duplicates, cap at 12.
out, last = [], None
for epoch, tool, txt in items:
    if txt == last:
        continue
    last = txt
    out.append((epoch, tool, txt))
    if len(out) >= 12:
        break

if not out:
    print("  (no prior prompts found for this project)")
else:
    for epoch, tool, txt in out:
        print(f"  [{tool:6} · {ago(epoch):>8}]  {txt}")
PY
