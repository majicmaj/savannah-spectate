#!/usr/bin/env bash
# Build the spectate viewer into dist/. Caddy on the box serves dist/ as static
# files (content-hashed bundles bust the cache), so a successful build IS the
# deploy — no service restart needed. Safe to run by hand or from the timer.
#
# The prebuild step (scripts/link-assets.mjs) re-links the game asset dirs into
# public/ and auto-detects the game checkout (sibling /home/majd/savanah on the
# box), so models/textures/audio stay in sync with the game.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[spectate-deploy] installing deps"
# Prefer a clean, lockfile-exact install; fall back to npm install if there's
# no package-lock.json on the box.
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo "[spectate-deploy] building"
npm run build

echo "[spectate-deploy] done — HEAD $(git rev-parse --short HEAD); Caddy serves dist/ ($(ls dist/assets/index-*.js 2>/dev/null | xargs -n1 basename 2>/dev/null | head -1))"
