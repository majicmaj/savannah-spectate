#!/usr/bin/env bash
# Run this ONCE ON THE BOX (when you're on its network) to turn on viewer ops:
#  1. auto-deploy — rebuilds the viewer on every push to origin/main.
#  2. wire-drift healthcheck — pages Discord if the deployed viewer's
#     SNAPSHOT_VERSION has fallen behind the game's (the silent "trees load,
#     no animals" outage). See tools/spectate-healthcheck.mjs.
# Mirrors the game's savanah-update.timer / savanah-alert-resources.timer.
# Needs sudo for the unit install (one-time only; neither job needs sudo at
# runtime). Idempotent — safe to re-run to pick up newly-added units.
#
#   ssh -t majdubuntu 'cd /home/majd/savannah-spectate && ./tools/install-autodeploy.sh'

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[install] copying systemd units (auto-deploy + wire-drift healthcheck)"
sudo cp "$ROOT/tools/savannah-spectate-update.service"      /etc/systemd/system/savannah-spectate-update.service
sudo cp "$ROOT/tools/savannah-spectate-update.timer"        /etc/systemd/system/savannah-spectate-update.timer
sudo cp "$ROOT/tools/savannah-spectate-healthcheck.service" /etc/systemd/system/savannah-spectate-healthcheck.service
sudo cp "$ROOT/tools/savannah-spectate-healthcheck.timer"   /etc/systemd/system/savannah-spectate-healthcheck.timer

echo "[install] daemon-reload + enable timers"
sudo systemctl daemon-reload
sudo systemctl enable --now savannah-spectate-update.timer
sudo systemctl enable --now savannah-spectate-healthcheck.timer

echo "[install] firing one deploy + one healthcheck now to confirm the flow works"
sudo systemctl start savannah-spectate-update.service || true
sudo systemctl start savannah-spectate-healthcheck.service || true

echo "[install] timer status:"
systemctl list-timers savannah-spectate-update.timer savannah-spectate-healthcheck.timer --no-pager || true
echo "[install] done."
echo "[install]   - viewer auto-deploys within ~2 min of any push to origin/main."
echo "[install]   - wire-version drift pages the Discord ops channel within ~5 min."
echo "[install] tail logs: journalctl -u savannah-spectate-update -f"
echo "[install]            journalctl -u savannah-spectate-healthcheck -f"
