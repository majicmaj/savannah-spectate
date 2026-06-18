#!/bin/bash
# Supervisor: keeps the spectate game-server (gateway :8091) and the Vite dev
# server (:5180) alive, restarting whichever has died. These dev processes get
# reaped periodically in this environment; this loop self-heals them.
#   game server: worktree with the spectator gateway, game port 8082, gateway 8091
#   vite: serves the spectate client at http://localhost:5180/
GODOT="/Applications/Godot.app/Contents/MacOS/Godot"
WT="/Users/majd/Projects/godot/savannah/.claude/worktrees/agent-a5c41574621820dfe"
SPEC="/Users/majd/Projects/godot/savannah-spectate"
LOGDIR="/Users/majd/.claude/jobs/83a08194/tmp"
mkdir -p "$LOGDIR"

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

echo "[run] supervisor started $(date)"
while true; do
  if ! listening 8091; then
    echo "[run] (re)starting game server → gateway :8091 (game :8082)"
    nohup "$GODOT" --headless --path "$WT" -- --server --port 8082 > "$LOGDIR/srv.log" 2>&1 &
    sleep 6
  fi
  if ! listening 5180; then
    echo "[run] (re)starting vite :5180"
    ( cd "$SPEC" && nohup npx vite --port 5180 --strictPort --host 0.0.0.0 > "$LOGDIR/vite.log" 2>&1 & )
    sleep 3
  fi
  sleep 4
done
