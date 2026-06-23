#!/usr/bin/env node
// Wire-version DRIFT monitor for the spectate viewer.
//
// The #1 cause of "watch.hobbyhood.app is down" (terrain/trees load but NO
// animals) is the game bumping SnapshotCodec.SNAPSHOT_VERSION without the
// viewer's decoder being bumped + redeployed in lockstep. The deployed viewer
// then rejects every snapshot frame → empty world. It's silent: nothing errors
// server-side, the site looks half-alive, and we only find out when a human
// notices. This has happened twice (v42->43, v43->44).
//
// This check connects to the box-local spectator gateway, reads the live wire
// SNAPSHOT_VERSION byte off a real snapshot frame, compares it to the version
// the DEPLOYED viewer source pins, and posts a Discord alert on mismatch. It
// runs on a 5-min systemd timer (savannah-spectate-healthcheck.timer).
//
// Zero npm deps: Node 22 has a global WebSocket + fetch. Reads the ops webhook
// from $DISCORD_ALERT_WEBHOOK_URL (provided by the systemd EnvironmentFile
// /etc/savanah/discord.env, same one the game's alert sidecar uses).
//
// Design choices:
//  - Gateway unreachable / no snapshot frame  => exit 0, NO alert. That means
//    the game server is down/restarting, which the game's own resource alert
//    already covers; alerting here too would just double-page on every deploy.
//    This monitor's ONE job is the silent drift case.
//  - Cooldown via a state file so a standing drift pages once, not every 5 min.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const GATEWAY = process.env.SPECTATE_GATEWAY_WS || "ws://localhost:8091/";
const WEBHOOK = process.env.DISCORD_ALERT_WEBHOOK_URL || "";
const STATE = join(HERE, ".healthcheck-state.json");
const FRAME_SNAPSHOT = 1;
const CONNECT_TIMEOUT_MS = 12000;
const REALERT_AFTER_MS = 6 * 60 * 60 * 1000; // re-page a standing drift every 6h

// Wall clock is fine here (not a sim) — used only for cooldown bookkeeping.
const now = Date.now();

function viewerVersion() {
  // The deployed checkout IS the deployed bundle's source (deploy = build from
  // this tree), so the source constant is the source of truth for "what the
  // live viewer expects". Regex-read it; no TS/tsx needed.
  const src = readFileSync(join(REPO, "src/net/snapshot_codec.ts"), "utf8");
  const m = src.match(/SNAPSHOT_VERSION\s*=\s*(\d+)/);
  if (!m) throw new Error("could not find SNAPSHOT_VERSION in snapshot_codec.ts");
  return Number(m[1]);
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; }
}

async function alert(msg) {
  console.error("[healthcheck] ALERT:", msg);
  if (!WEBHOOK) { console.error("[healthcheck] no DISCORD_ALERT_WEBHOOK_URL set — cannot page"); return; }
  try {
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: msg }),
    });
    if (!r.ok) console.error("[healthcheck] webhook POST failed:", r.status);
  } catch (e) { console.error("[healthcheck] webhook error:", e.message); }
}

// Pull one live snapshot frame and return its wire SNAPSHOT_VERSION byte.
// Resolves null if the gateway never sends a snapshot in time (server down /
// restarting) — that's a deliberate no-alert path.
function liveWireVersion() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { ws.close(); } catch {} resolve(v); } };
    const t = setTimeout(() => finish(null), CONNECT_TIMEOUT_MS);
    let ws;
    try { ws = new WebSocket(GATEWAY); } catch { clearTimeout(t); return resolve(null); }
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => {
      const b = new Uint8Array(e.data);
      // Frame is [frame_type u8][payload]; for a SNAPSHOT the payload's first
      // byte is SNAPSHOT_VERSION (net.gd _encode_snapshot_binary writes it
      // first). So the wire version is byte index 1 of the raw frame.
      if (b[0] === FRAME_SNAPSHOT && b.length >= 2) { clearTimeout(t); finish(b[1]); }
    };
    ws.onerror = () => { clearTimeout(t); finish(null); };
    ws.onclose = () => finish(null);
  });
}

const viewer = viewerVersion();
const wire = await liveWireVersion();

if (wire === null) {
  // Gateway silent: game down/restarting/no traffic. Not our alert to raise.
  console.log(`[healthcheck] gateway sent no snapshot frame (server down/restarting?) — viewer pins v${viewer}; skipping`);
  process.exit(0);
}

const state = loadState();

if (wire === viewer) {
  console.log(`[healthcheck] OK — wire v${wire} == viewer v${viewer}`);
  // Clear any standing drift so recovery re-arms a future alert.
  if (state.drift) writeFileSync(STATE, JSON.stringify({ ok_at: now }));
  process.exit(0);
}

// DRIFT. Page, but respect the cooldown for a standing mismatch.
const samePair = state.drift && state.wire === wire && state.viewer === viewer;
const cooled = samePair && state.alerted_at && (now - state.alerted_at) < REALERT_AFTER_MS;
if (cooled) {
  console.log(`[healthcheck] DRIFT v wire${wire}/viewer${viewer} still standing; within cooldown, not re-paging`);
  process.exit(2);
}

await alert(
  `🛰️ **Spectate viewer wire DRIFT** — watch.hobbyhood.app is showing terrain but **no animals**.\n` +
  `Live game wire \`SNAPSHOT_VERSION=${wire}\` but the deployed viewer pins \`${viewer}\`, so it rejects every snapshot frame.\n` +
  `Fix: bump \`src/net/snapshot_codec.ts\` (+ read any new bytes) and \`git push\` — auto-deploy lands it in ~2 min. ` +
  `See the \`spectate-viewer-wire-version-pin\` note.`
);
writeFileSync(STATE, JSON.stringify({ drift: true, wire, viewer, alerted_at: now }));
process.exit(2);
