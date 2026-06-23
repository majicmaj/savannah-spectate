# Auto-deploy + wire-drift healthcheck (spectate viewer)

The viewer is static files served by Caddy from `dist/` on the box, so deploying
is just **rebuild `dist/`** — no service restart, no runtime sudo. Two systemd
timers run on the box, both unprivileged (User=majd), mirroring the game's
`savanah-update.timer` / `savanah-alert-resources.timer`:

1. **auto-deploy** (`savannah-spectate-update.timer`, ~2 min) — rebuilds `dist/`
   when `origin/main` has new commits.
2. **wire-drift healthcheck** (`savannah-spectate-healthcheck.timer`, ~5 min) —
   the outage guard. The recurring "watch.hobbyhood.app is down" (terrain/trees
   render, **no animals**) is the game bumping `SnapshotCodec.SNAPSHOT_VERSION`
   without the viewer's decoder bumped + deployed in lockstep, so the live viewer
   silently rejects every snapshot. This check connects to the box-local gateway,
   reads the live wire `SNAPSHOT_VERSION`, compares it to the deployed viewer's,
   and pages the Discord ops channel on mismatch (cooldown: once per 6 h). Fix is
   then a one-line bump + push, which auto-deploys.

## One-time setup (run when you're on the box's network)

1. Land the latest code (this also brings these `tools/` files onto the box):
   ```sh
   ssh majdubuntu 'cd /home/majd/savannah-spectate && git reset --hard origin/main && npm run build'
   ```
2. Turn on both timers (installs + enables the systemd units; needs sudo once,
   so use `ssh -t` for the password prompt; idempotent — re-run to pick up new units):
   ```sh
   ssh -t majdubuntu 'cd /home/majd/savannah-spectate && ./tools/install-autodeploy.sh'
   ```

From then on every `git push origin main` goes live within ~2 min, and any wire
drift pages within ~5 min.

## Files

- `poll-deploy.sh` — deploy-timer entrypoint: fetch `origin/main`; if it moved,
  `git reset --hard` + run `deploy.sh`. No-op otherwise.
- `deploy.sh` — `npm ci`/`install` + `npm run build`. Safe to run by hand too.
- `spectate-healthcheck.mjs` — healthcheck-timer entrypoint: read live wire
  version off the gateway vs the deployed viewer's, page Discord on drift. Pure
  Node (no deps); reads `DISCORD_ALERT_WEBHOOK_URL` from `/etc/savanah/discord.env`
  (via the service's `EnvironmentFile`). Cooldown state in `tools/.healthcheck-state.json`
  (gitignored; survives `git reset --hard`). Exit 2 = drift handled.
- `savannah-spectate-update.{service,timer}` — auto-deploy units.
- `savannah-spectate-healthcheck.{service,timer}` — drift-monitor units.
- `install-autodeploy.sh` — copies all units, enables both timers, fires one of each.

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
