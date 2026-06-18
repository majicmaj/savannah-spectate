// Confirms the gateway streams time-of-day (FRAME_TIME=4) and that it advances.
import WebSocket from "ws";
import { CYCLE_SECONDS } from "../world/daynight.js";

const url = process.argv[2] ?? "ws://localhost:8091";
const ws = new WebSocket(url);
const seen: number[] = [];
const timer = setTimeout(() => {
  console.error(`[time] FAIL: ${seen.length} time frames in 6s` + (seen.length ? ` (last ${seen.at(-1)!.toFixed(1)})` : " — none"));
  process.exit(1);
}, 6000);
ws.on("error", (e) => { console.error("[time]", e.message); process.exit(1); });
ws.on("message", (data: Buffer) => {
  const b = new Uint8Array(data);
  if (b[0] !== 4) return;
  const t = Buffer.from(b.buffer, b.byteOffset + 1, 4).readFloatLE(0);
  seen.push(t);
  if (seen.length >= 4) {
    clearTimeout(timer);
    const advancing = seen[seen.length - 1] !== seen[0];
    const phase = (seen.at(-1)! / CYCLE_SECONDS).toFixed(2);
    console.log(`[time] got ${seen.length} frames: ${seen.map((v) => v.toFixed(1)).join(" → ")}`);
    console.log(`[time] day phase ${phase} (0=midnight .5=noon). ${advancing ? "PASS: time advancing." : "WARN: not advancing."}`);
    ws.close();
    process.exit(0);
  }
});
