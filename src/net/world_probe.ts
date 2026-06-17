// Validates the streamed heightmap end-to-end: ingests the WORLD_HEIGHTS frame,
// then checks that grounded animals' server py matches my terrain surface (h+1).
// If the error is ~0, the terrain the client meshes is the same ground the
// animals stand on. Run: npx tsx src/net/world_probe.ts [ws://host:8091]

import WebSocket from "ws";
import { decodeSnapshot } from "./snapshot_codec.js";
import { Heightmap } from "../world/heightmap.js";
import { P, SPECIES_LABELS } from "../world/constants.js";

const url = process.argv[2] ?? "ws://localhost:8091";
const ws = new WebSocket(url);
const hm = new Heightmap();
let reported = false;

const timer = setTimeout(() => {
  console.error("[world] FAIL: timeout (no heightmap+snapshot in 12s)");
  process.exit(1);
}, 12000);

ws.on("open", () => console.log("[world] open"));
ws.on("error", (e) => { console.error("[world] ws error", e.message); process.exit(1); });
ws.on("message", (data: Buffer) => {
  const bytes = new Uint8Array(data);
  const type = bytes[0];
  const payload = bytes.subarray(1);
  if (type === 3) {
    hm.ingest(payload);
    console.log(`[world] heightmap frame: ${payload.byteLength} bytes → ${hm.W}x${hm.H}`);
    return;
  }
  if (type !== 1 || !hm.loaded || reported) return;
  const snap = decodeSnapshot(payload);
  if (!snap) return;
  reported = true;
  clearTimeout(timer);

  let n = 0, sumErr = 0, maxErr = 0;
  const samples: string[] = [];
  for (const [id, a] of snap.p) {
    if ((a[P.FLIGHT_MODE] as number) > 0) continue; // skip flying
    const x = a[P.PX] as number, z = a[P.PZ] as number, py = a[P.PY] as number;
    const surf = hm.surfaceAt(x, z);
    const err = py - surf;
    n++;
    sumErr += Math.abs(err);
    maxErr = Math.max(maxErr, Math.abs(err));
    if (samples.length < 6)
      samples.push(`${SPECIES_LABELS[(a[P.ANIMAL] as number) & 7]} #${id}: py=${py.toFixed(1)} surf=${surf.toFixed(1)} Δ=${err.toFixed(2)}`);
  }
  console.log(`[world] grounded animals checked: ${n}`);
  for (const s of samples) console.log("   " + s);
  const avg = n ? sumErr / n : 0;
  console.log(`[world] |py - surface| avg=${avg.toFixed(2)} max=${maxErr.toFixed(2)} (low = terrain matches animal ground)`);
  console.log(avg < 2.0 ? "[world] PASS: streamed terrain grounds the animals." : "[world] WARN: terrain/animal mismatch — check coord mapping.");
  ws.close();
  process.exit(0);
});
