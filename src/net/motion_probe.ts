// Diagnoses "stop-and-go": tracks ALL entities across N snapshots, then reports
// the one with the most total path — its per-snapshot deltas reveal whether the
// server streams smooth motion (steady small deltas) or stepped teleports.

import WebSocket from "ws";
import { decodeSnapshot } from "./snapshot_codec.js";
import { P, SPECIES_LABELS } from "../world/constants.js";

const url = process.argv[2] ?? "ws://localhost:8091";
const ws = new WebSocket(url);
const N = 16;
const hist = new Map<number, { t: number; x: number; z: number; animal: number }[]>();
let count = 0;

const timer = setTimeout(() => { console.error("[motion] timeout"); process.exit(1); }, 14000);
ws.on("error", (e) => { console.error("[motion]", e.message); process.exit(1); });
ws.on("message", (data: Buffer) => {
  const b = new Uint8Array(data);
  if (b[0] !== 1) return;
  const snap = decodeSnapshot(b.subarray(1));
  if (!snap) return;
  const now = performance.now();
  for (const [id, a] of snap.p) {
    if ((a[P.FLIGHT_MODE] as number) > 0) continue;
    const arr = hist.get(id) ?? hist.set(id, []).get(id)!;
    arr.push({ t: now, x: a[P.PX] as number, z: a[P.PZ] as number, animal: (a[P.ANIMAL] as number) & 7 });
  }
  count++;
  if (count < N) return;
  clearTimeout(timer);

  // pick entity with most total path length
  let bestId = -1, bestPath = -1;
  for (const [id, arr] of hist) {
    let path = 0;
    for (let i = 1; i < arr.length; i++) path += Math.hypot(arr[i].x - arr[i - 1].x, arr[i].z - arr[i - 1].z);
    if (path > bestPath) { bestPath = path; bestId = id; }
  }
  const arr = hist.get(bestId)!;
  console.log(`[motion] most-moving: ${SPECIES_LABELS[arr[0].animal]} #${bestId}, total path ${bestPath.toFixed(1)} m over ${arr.length} snaps`);
  console.log("[motion] dt_ms    dist   (per-snapshot step)");
  let nonzero = 0;
  for (let i = 1; i < arr.length; i++) {
    const dt = arr[i].t - arr[i - 1].t;
    const d = Math.hypot(arr[i].x - arr[i - 1].x, arr[i].z - arr[i - 1].z);
    if (d > 0.001) nonzero++;
    console.log(`  ${dt.toFixed(0).padStart(5)}   ${d.toFixed(3).padStart(6)}`);
  }
  console.log(`[motion] ${nonzero}/${arr.length - 1} snapshots had movement — ${nonzero > (arr.length - 1) * 0.7 ? "SMOOTH (steady deltas → client interp should work)" : "STEPPED (server sends discrete jumps)"}`);
  ws.close();
  process.exit(0);
});
