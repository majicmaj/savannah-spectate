// Live end-to-end probe: connects to the running game's spectator gateway,
// runs the REAL decodeSnapshot on the REAL server bytes, prints a summary.
// Validates the whole chain (gateway framing → WS → TS codec) headlessly.
// Uses the `ws` package (Node's global undici WebSocket is overly strict about
// Godot's handshake; browsers are lenient and work with the native WebSocket).
// Run: npx tsx src/net/live_probe.ts [ws://host:8091]

import WebSocket from "ws";
import { decodeSnapshot } from "./snapshot_codec.js";
import { SPECIES_LABELS } from "../world/constants.js";

const url = process.argv[2] ?? "ws://localhost:8091";
const FRAME_SNAPSHOT = 1;
const FRAME_WORLD_INIT = 2;
const WANT = 6;

console.log(`[probe] connecting ${url} ...`);
const ws = new WebSocket(url);

let got = 0;
let worldInitBytes = 0;
const sizes: number[] = [];
const timer = setTimeout(() => {
  console.error("[probe] FAIL: timeout (no snapshots in 8s)");
  process.exit(1);
}, 8000);

ws.on("open", () => console.log("[probe] open"));
ws.on("error", (e) => {
  console.error("[probe] FAIL: ws error", e.message);
  process.exit(1);
});
ws.on("message", (data: Buffer) => {
  const bytes = new Uint8Array(data);
  const type = bytes[0];
  const payload = bytes.subarray(1);
  if (type === FRAME_WORLD_INIT) {
    worldInitBytes = payload.byteLength;
    console.log(`[probe] world_init frame: ${worldInitBytes} bytes`);
    return;
  }
  if (type !== FRAME_SNAPSHOT) return;
  const snap = decodeSnapshot(payload);
  if (!snap) {
    console.error(`[probe] FAIL: decodeSnapshot returned null (frame ${payload.byteLength} B)`);
    process.exit(1);
  }
  got++;
  sizes.push(payload.byteLength);
  if (got === 1) {
    const hist: Record<number, number> = {};
    let sample: any[] | null = null;
    for (const [, arr] of snap.p) {
      const a = (arr[4] as number) & 7;
      hist[a] = (hist[a] ?? 0) + 1;
      if (!sample) sample = arr;
    }
    console.log(`[probe] frame=${payload.byteLength} B  players=${snap.p.size} corpses=${snap.c.size} tick=${snap.serverTick} kf=${snap.isKeyframe}`);
    console.log(`[probe] weather wetness=${snap.wetness.toFixed(2)} rain=${snap.rain.toFixed(2)} waterOffset=${snap.waterOffset}`);
    console.log(`[probe] species: ${Object.entries(hist).map(([a, n]) => `${SPECIES_LABELS[+a]}=${n}`).join(" ")}`);
    if (sample) {
      console.log(
        `[probe] sample: ${SPECIES_LABELS[(sample[4] as number) & 7]} ` +
          `pos=(${(sample[0] as number).toFixed(1)}, ${(sample[8] as number).toFixed(1)}, ${(sample[1] as number).toFixed(1)}) ` +
          `yaw=${(sample[23] as number).toFixed(2)} size=${(sample[2] as number).toFixed(2)} hp=${(sample[3] as number).toFixed(1)}/${(sample[12] as number).toFixed(1)}`,
      );
    }
  }
  if (got >= WANT) {
    clearTimeout(timer);
    const avg = (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(0);
    console.log(`[probe] PASS: decoded ${got} live snapshots cleanly. avg frame ${avg} B (~${((+avg * 20) / 1024).toFixed(0)} KB/s @20Hz), world_init=${worldInitBytes}B.`);
    ws.close();
    process.exit(0);
  }
});
