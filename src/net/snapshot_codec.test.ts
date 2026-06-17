// Hand-builds a minimal keyframe snapshot (1 player, 1 corpse) using the SAME
// pack formulas as snapshot_codec.gd, decodes it, and asserts round-trip within
// quantization tolerance. Run: `npm test` (tsx). Not a substitute for validating
// against real gateway bytes, but catches byte-layout/endianness regressions.

import { decodeSnapshot, SNAPSHOT_VERSION } from "./snapshot_codec.js";
import { WORLD_SIZE, WORLD_HALF, P } from "../world/constants.js";

const TAU = Math.PI * 2;
const Q = 65535.0;
const packPosXZ = (v: number) => Math.round(((v + WORLD_HALF) / WORLD_SIZE) * Q);
const packPosY = (v: number) => Math.round(((v - -20.0) / 220.0) * Q);
const packYaw = (y: number) => Math.round((((y % TAU) + TAU) % TAU) / TAU * Q);
const packYawU8 = (y: number) => Math.round((((y % TAU) + TAU) % TAU) / TAU * 255);
const packUnit = (v: number) => Math.round(v * 255);
const packSize = (v: number) => Math.round((v / 24.0) * Q);
const packHp = (v: number) => Math.round((v / 1024.0) * Q);
const packSizeU8 = (v: number) => Math.round((v / 24.0) * 255);

class W {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  s8(v: number) { this.bytes.push(v & 0xff); }
  u16(v: number) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); }
  u32(v: number) { this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); }
  out() { return new Uint8Array(this.bytes); }
}

let failures = 0;
function near(label: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) { failures++; console.error(`FAIL ${label}: got ${got}, want ~${want} (±${tol})`); }
  else console.log(`ok   ${label}: ${got.toFixed(3)} ≈ ${want}`);
}
function eq(label: string, got: any, want: any) {
  const ok = got === want;
  if (!ok) { failures++; console.error(`FAIL ${label}: got ${got}, want ${want}`); }
  else console.log(`ok   ${label}: ${got}`);
}

const w = new W();
// header
w.u8(SNAPSHOT_VERSION);
w.u16(1234); // server_tick
w.u16(7); // seq
w.u8(1); // is_keyframe
w.u16(0); // ack_seq
w.u8(0); // has_local_sim = 0
// weather (3 B)
w.u8(packUnit(0.5)); // wetness
w.u8(packUnit(0.25)); // rain
w.s8(-3); // water_offset
// entries
w.u16(1); // n_p
w.u32(42); // id
w.u8(0x03); // mask hot+cold
// hot slice
w.u16(packPosXZ(100.0)); // px
w.u16(packPosXZ(-250.0)); // pz
w.u16(packPosY(3.5)); // py
w.u16(packYaw(1.0)); // yaw
w.u16(0); // head_packed
// cold slice (order = _encode_p_cold)
w.u16(packSize(7.5)); // size
w.u16(packHp(44.0)); // hp
w.u8(1); // animal = Elephant
w.u8(packUnit(0.8)); // stamina
w.u8(packUnit(0.6)); // thirst
w.u8(packUnit(0.3)); // hunger
w.u16(packHp(50.0)); // hp_max
w.u8(Math.round((1.05 - 0.9) * 1000)); // size_roll
w.u8(3); // ai_state = hunt
w.u8(0); // flags
w.u8(0); // flags2
w.u8(0); // flight_mode
w.u16(99); // group_id
w.u8(255); // last_call_type (255 → no time float)
w.u16(5); // kills
w.u16(120); // run_seconds
w.u8(0); // perk_pending
w.u8(0); // grab_byte = idle
w.u8(packUnit(1.0)); // sleep_bar
w.u8(100 + 25); // affinity = +25
// corpses
w.u16(1); // n_c
w.u32(900); // corpse id
w.u16(packPosXZ(10.0)); // cx
w.u16(packPosXZ(20.0)); // cz
w.u8(packSizeU8(5.0)); // size
w.u8(128); // meat_ratio
w.u8(packYawU8(2.0)); // yaw
w.u8(5); // age_ds
// group roster
w.u16(0); // n_g

const dec = decodeSnapshot(w.out());
if (!dec) {
  console.error("FAIL: decodeSnapshot returned null");
  process.exit(1);
}

eq("isKeyframe", dec.isKeyframe, true);
eq("serverTick", dec.serverTick, 1234);
eq("snapSeq", dec.snapSeq, 7);
near("wetness", dec.wetness, 0.5, 0.01);
near("rain", dec.rain, 0.25, 0.01);
eq("waterOffset", dec.waterOffset, -3);
eq("player count", dec.p.size, 1);

const pl = dec.p.get(42)!;
near("px", pl[P.PX], 100.0, 0.05);
near("pz", pl[P.PZ], -250.0, 0.05);
near("py", pl[P.PY], 3.5, 0.01);
near("yaw", pl[P.YAW], 1.0, 0.001);
near("size", pl[P.SIZE], 7.5, 0.01);
near("hp", pl[P.HP], 44.0, 0.05);
eq("animal", pl[P.ANIMAL], 1);
near("stamina", pl[P.STAMINA], 0.8, 0.01);
near("hp_max", pl[P.HP_MAX], 50.0, 0.05);
eq("ai_state", pl[P.AI_STATE], 3);
eq("group_id", pl[P.GROUP_ID], 99);
eq("kills", pl[P.KILLS], 5);
near("affinity", pl[P.AFFINITY], 25, 0.5);

eq("corpse count", dec.c.size, 1);
const co = dec.c.get(900)!;
near("corpse x", co[0], 10.0, 0.05);
near("corpse z", co[1], 20.0, 0.05);
near("corpse size", co[2], 5.0, 0.1);
near("corpse meat", co[3], 128 / 255, 0.01);
near("corpse yaw", co[4], 2.0, 0.03);
eq("corpse age", co[5], 5);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll snapshot codec round-trip assertions passed.");
