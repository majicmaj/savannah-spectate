#!/usr/bin/env bash
# Poll GitHub origin/main; if there are new commits, hard-reset to them and run
# deploy.sh (npm build → Caddy serves the new dist/). No-op when local HEAD
# already matches remote, so it's safe to fire on a tight timer.
#
# Invoked by the savannah-spectate-update.timer systemd unit on the box.
# Mirrors the game's tools/poll-update.sh, minus the godot/sudo restart — the
# viewer is static files served by Caddy, so a rebuild IS the deploy.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${BRANCH:-main}"

git fetch --quiet origin "$BRANCH"

LOCAL="$(git rev-parse "$BRANCH")"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  # Nothing to do. Stay quiet so journalctl doesn't fill up.
  exit 0
fi

echo "[spectate-deploy] new commits on origin/$BRANCH ($LOCAL -> $REMOTE); deploying"
# Reset BEFORE building so any change to deploy.sh in the new commit applies
# this same cycle. A stray Godot-generated symlink/artifact can't block a
# hard reset (unlike git pull --ff-only).
git reset --hard "origin/$BRANCH"
exec ./tools/deploy.sh
