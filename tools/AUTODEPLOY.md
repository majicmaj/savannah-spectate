# Auto-deploy (spectate viewer)

The viewer is static files served by Caddy from `dist/` on the box, so deploying
is just **rebuild `dist/`** — no service restart, no runtime sudo. This timer
polls `origin/main` every ~2 min and rebuilds when there are new commits, exactly
like the game's `savanah-update.timer` (minus the godot restart).

## One-time setup (run when you're on the box's network)

1. Land the latest code (this also brings these `tools/` files onto the box):
   ```sh
   ssh majdubuntu 'cd /home/majd/savannah-spectate && git reset --hard origin/main && npm run build'
   ```
2. Turn on auto-deploy (installs + enables the systemd timer; needs sudo once):
   ```sh
   ssh majdubuntu 'cd /home/majd/savannah-spectate && ./tools/install-autodeploy.sh'
   ```

That's it. From then on, every `git push origin main` to the viewer repo goes
live within ~2 min — no manual rebuild.

## Files

- `poll-deploy.sh` — timer entrypoint: fetch `origin/main`; if it moved,
  `git reset --hard` + run `deploy.sh`. No-op otherwise.
- `deploy.sh` — `npm ci`/`install` + `npm run build`. Safe to run by hand too.
- `savannah-spectate-update.service` / `.timer` — the systemd units.
- `install-autodeploy.sh` — copies the units, enables the timer, fires one deploy.

## Ops

```sh
systemctl list-timers savannah-spectate-update.timer   # next fire
journalctl -u savannah-spectate-update -f              # live deploy logs
sudo systemctl start savannah-spectate-update.service  # force a deploy now
sudo systemctl disable --now savannah-spectate-update.timer  # turn it off
```

## Notes

- Why poll, not a webhook: the box is behind NAT (Cloudflare tunnel for the site
  only), so an inbound GitHub webhook would need extra plumbing. Polling matches
  the game's proven pattern and is plenty fast for a spectate viewer.
- Wire-version coupling: when the **game** bumps `SnapshotCodec.SNAPSHOT_VERSION`,
  the viewer's decoder must be bumped + pushed too, or it rejects snapshots
  (trees/terrain load, no animals). Auto-deploy makes that a one-push fix instead
  of a manual box rebuild. See the repo's snapshot_codec.ts version constants.
