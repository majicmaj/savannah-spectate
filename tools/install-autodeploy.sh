#!/usr/bin/env bash
# Run this ONCE ON THE BOX (when you're on its network) to turn on auto-deploy:
# it installs the systemd timer that rebuilds the spectate viewer on every push
# to origin/main. Mirrors the game's savanah-update.timer. Needs sudo for the
# unit install (one-time only; the deploy itself never needs sudo).
#
#   ssh majdubuntu 'cd /home/majd/savannah-spectate && ./tools/install-autodeploy.sh'

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[install] copying systemd units"
sudo cp "$ROOT/tools/savannah-spectate-update.service" /etc/systemd/system/savannah-spectate-update.service
sudo cp "$ROOT/tools/savannah-spectate-update.timer"   /etc/systemd/system/savannah-spectate-update.timer

echo "[install] daemon-reload + enable timer"
sudo systemctl daemon-reload
sudo systemctl enable --now savannah-spectate-update.timer

echo "[install] firing one deploy now to confirm the flow works"
sudo systemctl start savannah-spectate-update.service || true

echo "[install] timer status:"
systemctl list-timers savannah-spectate-update.timer --no-pager || true
echo "[install] done — the viewer now auto-deploys within ~2 min of any push to origin/main."
echo "[install] tail logs with: journalctl -u savannah-spectate-update -f"
