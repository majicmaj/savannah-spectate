// Verifies the AI/physics-LOD anchor fix: tracks one entity, uplinks its position
// as the spectate center every snapshot (so the server anchors LOD there), and
// after a warmup measures per-snapshot deltas. Smooth = steady small deltas every
// snapshot (vs the pre-fix 0,0,0,big,0 step pattern).

import WebSocket from "ws";
import { decodeSnapshot } from "./snapshot_codec.js";
import { P, SPECIES_LABELS } from "../world/constants.js";

const url = process.argv[2] ?? "ws://localhost:8091";
const ws = new WebSocket(url);
let trackId = -1;
let snaps = 0;
const WARMUP = 20, MEASURE = 16;
const deltas: { dt: number; d: number }[] = [];
let prev: { t: number; x: number; z: number } | null = null;

function sendCenter(x: number, z: number) {
  const buf = Buffer.alloc(9);
  buf.writeUInt8(1, 0);
  buf.writeFloatLE(x, 1);
  buf.writeFloatLE(z, 5);
  ws.send(buf);
}

const timer = setTimeout(() => { console.error("[stopgo] timeout"); process.exit(1); }, 20000);
ws.on("error", (e) => { console.error("[stopgo]", e.message); process.exit(1); });
ws.on("message", (data: Buffer) => {
  const b = new Uint8Array(data);
  if (b[0] !== 1) return;
  const snap = decodeSnapshot(b.subarray(1));
  if (!snap) return;
  const now = performance.now();

  if (trackId < 0) {
    for (const [id, a] of snap.p) {
      if ((a[P.FLIGHT_MODE] as number) === 0) { trackId = id; console.log(`[stopgo] anchoring + tracking ${SPECIES_LABELS[(a[P.ANIMAL] as number) & 7]} #${id}`); break; }
    }
  }
  const a = snap.p.get(trackId);
  if (!a) return;
  const x = a[P.PX] as number, z = a[P.PZ] as number;
  sendCenter(x, z); // anchor LOD at the tracked entity

  snaps++;
  if (snaps > WARMUP) {
    if (prev) deltas.push({ dt: now - prev.t, d: Math.hypot(x - prev.x, z - prev.z) });
  }
  prev = { t: now, x, z };

  if (deltas.length >= MEASURE) {
    clearTimeout(timer);
    const moved = deltas.filter((s) => s.d > 0.001).length;
    const avg = deltas.reduce((a, s) => a + s.d, 0) / deltas.length;
    console.log("[stopgo] post-anchor per-snapshot deltas (m):");
    console.log("  " + deltas.map((s) => s.d.toFixed(2)).join(" "));
    console.log(`[stopgo] ${moved}/${deltas.length} snapshots moved, avg ${avg.toFixed(3)} m`);
    console.log(moved >= deltas.length * 0.7
      ? "[stopgo] PASS: motion is now smooth (steady deltas) — anchor works."
      : "[stopgo] STILL STEPPED: anchor not taking effect.");
    ws.close();
    process.exit(0);
  }
});
