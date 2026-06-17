// TypeScript port of the DECODE path of ../savannah/scripts/net/snapshot_codec.gd
// (class SnapshotCodec). Pure functions: bytes in, structured state out. The
// spectator only ever decodes, so encode is intentionally omitted.
//
// MUST stay in lockstep with the game's SnapshotCodec.SNAPSHOT_VERSION. The
// gateway tags each snapshot frame and the server rejects mismatched clients;
// here we surface a console error and drop the packet (mirrors push_error).
//   source SNAPSHOT_VERSION: 42 (snapshot_codec.gd:28)

import { ByteReader } from "./stream.js";
import { WORLD_SIZE, WORLD_HALF } from "../world/constants.js";

export const SNAPSHOT_VERSION = 42;
export const FOOD_EVENTS_VERSION = 3;
export const ITEM_EVENTS_VERSION = 1;

const MAX_DECODE_N = 8192; // snapshot_codec.gd:25

const TAU = Math.PI * 2;
const POS_QUANT_RANGE = 65535.0;
const POS_Y_MIN = -20.0;
const POS_Y_RANGE = 220.0;
const SIZE_RANGE = 24.0;
const HP_RANGE = 1024.0;
const HEAD_YAW_MAX = Math.PI / 2;
const HEAD_PITCH_MAX = Math.PI / 2;

// --- unpack helpers (mirror snapshot_codec.gd) ---
export const unpackPosXZ = (u: number) => (u / POS_QUANT_RANGE) * WORLD_SIZE - WORLD_HALF;
export const unpackPosY = (u: number) => (u / POS_QUANT_RANGE) * POS_Y_RANGE + POS_Y_MIN;
export const unpackYaw = (u: number) => (u / POS_QUANT_RANGE) * TAU;
export const unpackYawU8 = (u: number) => (u / 255.0) * TAU;
export const unpackUnit = (u: number) => u / 255.0;
export const unpackSize = (u: number) => (u / POS_QUANT_RANGE) * SIZE_RANGE;
export const unpackHp = (u: number) => (u / POS_QUANT_RANGE) * HP_RANGE;
export const unpackSizeU8 = (u: number) => (u / 255.0) * SIZE_RANGE;
export function unpackHead(u: number): { yaw: number; pitch: number } {
  return {
    yaw: (((u >> 8) & 0xff) / 255.0 * 2.0 - 1.0) * HEAD_YAW_MAX,
    pitch: ((u & 0xff) / 255.0 * 2.0 - 1.0) * HEAD_PITCH_MAX,
  };
}

// 39-slot defaulted player record (snapshot_codec.gd:158 empty_player_arr).
export function emptyPlayerArr(): any[] {
  return [
    0.0, 0.0, 0.0, 0.0, 0, 0, "", 0.0, 0.0, 0.0, false, 0.0, 0.0, 1.0, 0,
    false, 0.0, 0, 255, 0.0, 0, 0, 0, 0.0, false, false, false, false, false, false, 0,
    0, 0, 0, 0, 0, 1.0, false, 0.0,
  ];
}

function checkDecodeN(n: number, minBytes: number, buf: ByteReader, what: string): boolean {
  if (n > MAX_DECODE_N) {
    console.error(`[spectate] ${what}: decode N=${n} > MAX_DECODE_N=${MAX_DECODE_N}`);
    return false;
  }
  if (buf.available < n * minBytes) {
    console.error(`[spectate] ${what}: decode N=${n} × ${minBytes}B > ${buf.available}B available`);
    return false;
  }
  return true;
}

// snapshot_codec.gd:211 _decode_p_hot → [px, pz, py, yaw, head_packed]
function decodePHot(buf: ByteReader): [number, number, number, number, number] {
  return [unpackPosXZ(buf.getU16()), unpackPosXZ(buf.getU16()), unpackPosY(buf.getU16()), unpackYaw(buf.getU16()), buf.getU16()];
}

// snapshot_codec.gd:289 _decode_p_cold → {index: value}
function decodePCold(buf: ByteReader): Record<number, any> {
  const d: Record<number, any> = {};
  d[2] = unpackSize(buf.getU16());
  d[3] = unpackHp(buf.getU16());
  d[4] = buf.getU8();
  d[6] = "";
  d[7] = unpackUnit(buf.getU8());
  d[9] = unpackUnit(buf.getU8());
  d[11] = unpackUnit(buf.getU8());
  d[12] = unpackHp(buf.getU16());
  d[13] = 0.9 + buf.getU8() / 1000.0;
  d[14] = buf.getU8();
  const flags = buf.getU8();
  d[10] = (flags & 1) !== 0;
  d[15] = (flags & 2) !== 0;
  d[24] = (flags & 4) !== 0;
  d[25] = (flags & 8) !== 0;
  d[26] = (flags & 16) !== 0;
  d[27] = (flags & 32) !== 0;
  d[28] = (flags & 64) !== 0;
  d[29] = (flags & 128) !== 0;
  const flags2 = buf.getU8();
  d[37] = (flags2 & 1) !== 0;
  d[30] = buf.getU8() & 0xff;
  d[17] = buf.getU16();
  const lct = buf.getU8();
  d[18] = lct;
  d[19] = lct !== 255 ? buf.getFloat() : 0.0;
  d[20] = buf.getU16();
  d[21] = buf.getU16();
  d[22] = buf.getU8();
  const grabByte = buf.getU8() & 0xff;
  d[31] = grabByte & 0x03;
  d[32] = (grabByte >> 2) & 0x3f;
  d[33] = 0;
  d[34] = 0;
  if (grabByte !== 0) {
    d[33] = buf.getU32();
    if ((grabByte & (1 << 4)) !== 0) d[34] = buf.getU8();
  }
  d[36] = unpackUnit(buf.getU8());
  d[38] = buf.getU8() - 100.0;
  return d;
}

export interface DecodedSnapshot {
  p: Map<number, any[]>;
  c: Map<number, [number, number, number, number, number, number]>; // x,z,size,meat,yaw,age_ds
  g: Map<number, any[]>; // [animal, name, px, pz, size, hp, hp_max, ai_code, sleeping]
  ackSeq: number;
  isKeyframe: boolean;
  snapSeq: number;
  serverTick: number;
  removedIds: number[];
  wetness: number;
  rain: number;
  waterOffset: number;
}

// snapshot_codec.gd:535 decode_snapshot. baselinePlayers is the prior post-merge
// map (kept by the caller); on a keyframe it's ignored.
export function decodeSnapshot(bytes: Uint8Array, baselinePlayers?: Map<number, any[]>): DecodedSnapshot | null {
  if (bytes.byteLength < 9) return null;
  const buf = new ByteReader(bytes);
  const version = buf.getU8();
  if (version !== SNAPSHOT_VERSION) {
    console.error(`[spectate] snapshot version mismatch: got ${version}, want ${SNAPSHOT_VERSION}`);
    return null;
  }
  const serverTick = buf.getU16();
  const snapSeq = buf.getU16();
  const isKeyframe = buf.getU8() !== 0;
  const ackSeq = buf.getU16();
  if (buf.getU8() !== 0) {
    // local_sim block (54 B) — irrelevant to a spectator, skip past it.
    if (buf.available < 54) {
      console.error("[spectate] snapshot.local_sim truncated");
      return null;
    }
    buf.getData(54);
  }
  if (buf.available < 3) {
    console.error("[spectate] snapshot.weather truncated");
    return null;
  }
  const wetness = buf.getU8() / 255.0;
  const rain = buf.getU8() / 255.0;
  const waterOffset = buf.getS8();

  const p: Map<number, any[]> = isKeyframe || !baselinePlayers ? new Map() : new Map(baselinePlayers);
  const removedIds: number[] = [];

  let n = buf.getU16();
  if (!checkDecodeN(n, 5, buf, "snapshot.entries")) return null;
  const template = emptyPlayerArr();
  for (let i = 0; i < n; i++) {
    const id = buf.getU32();
    const mask = buf.getU8();
    if ((mask & 0x80) !== 0) {
      p.delete(id);
      removedIds.push(id);
      continue;
    }
    const existing = p.get(id);
    const arr = existing ? existing.slice() : emptyPlayerArr();
    while (arr.length < template.length) arr.push(template[arr.length]);
    if ((mask & 0x01) !== 0) {
      const hot = decodePHot(buf);
      arr[0] = hot[0];
      arr[1] = hot[1];
      arr[8] = hot[2];
      arr[23] = hot[3];
      arr[35] = hot[4];
    }
    if ((mask & 0x02) !== 0) {
      const cold = decodePCold(buf);
      for (const ci in cold) arr[+ci] = cold[ci];
    }
    p.set(id, arr);
  }

  const c: Map<number, [number, number, number, number, number, number]> = new Map();
  n = buf.getU16();
  if (!checkDecodeN(n, 12, buf, "snapshot.corpses")) return null;
  for (let i = 0; i < n; i++) {
    const id = buf.getU32();
    const x = unpackPosXZ(buf.getU16());
    const z = unpackPosXZ(buf.getU16());
    const size = unpackSizeU8(buf.getU8());
    const meatRatio = buf.getU8() / 255.0;
    const cyaw = unpackYawU8(buf.getU8());
    const ageDs = buf.getU8();
    c.set(id, [x, z, size, meatRatio, cyaw, ageDs]);
  }

  const g: Map<number, any[]> = new Map();
  n = buf.getU16();
  if (!checkDecodeN(n, 17, buf, "snapshot.group_roster")) return null;
  for (let i = 0; i < n; i++) {
    const id = buf.getU32();
    const animal = buf.getU8();
    const px = unpackPosXZ(buf.getU16());
    const pz = unpackPosXZ(buf.getU16());
    const size = unpackSize(buf.getU16());
    const hp = unpackHp(buf.getU16());
    const hpMax = unpackHp(buf.getU16());
    const aiCode = buf.getU8();
    const sleeping = buf.getU8() !== 0;
    g.set(id, [animal, "", px, pz, size, hp, hpMax, aiCode, sleeping]);
  }

  return { p, c, g, ackSeq, isKeyframe, snapSeq, serverTick, removedIds, wetness, rain, waterOffset };
}

// snapshot_codec.gd:721 decode_food_events → {added,scaled} of [id, foodByte]
export function decodeFoodEvents(bytes: Uint8Array): { added: [number, number][]; scaled: [number, number][] } {
  const empty = { added: [] as [number, number][], scaled: [] as [number, number][] };
  if (bytes.byteLength < 1) return empty;
  const buf = new ByteReader(bytes);
  if (buf.getU8() !== FOOD_EVENTS_VERSION) {
    console.error("[spectate] food_events version mismatch");
    return empty;
  }
  const added: [number, number][] = [];
  let n = buf.getU16();
  if (!checkDecodeN(n, 5, buf, "food_events.added")) return empty;
  for (let i = 0; i < n; i++) added.push([buf.getU32(), buf.getU8()]);
  const scaled: [number, number][] = [];
  n = buf.getU16();
  if (!checkDecodeN(n, 5, buf, "food_events.scaled")) return { added, scaled: [] };
  for (let i = 0; i < n; i++) scaled.push([buf.getU32(), buf.getU8()]);
  return { added, scaled };
}

// snapshot_codec.gd:853 decode_item_events → {added: [id,x,z,kind], removed: [id]}
export function decodeItemEvents(bytes: Uint8Array): { added: [number, number, number, number][]; removed: number[] } {
  const empty = { added: [] as [number, number, number, number][], removed: [] as number[] };
  if (bytes.byteLength < 1) return empty;
  const buf = new ByteReader(bytes);
  if (buf.getU8() !== ITEM_EVENTS_VERSION) {
    console.error("[spectate] item_events version mismatch");
    return empty;
  }
  const added: [number, number, number, number][] = [];
  let n = buf.getU16();
  if (!checkDecodeN(n, 9, buf, "item_events.added")) return empty;
  for (let i = 0; i < n; i++) added.push([buf.getU32(), unpackPosXZ(buf.getU16()), unpackPosXZ(buf.getU16()), buf.getU8()]);
  const removed: number[] = [];
  n = buf.getU16();
  if (!checkDecodeN(n, 4, buf, "item_events.removed")) return { added, removed: [] };
  for (let i = 0; i < n; i++) removed.push(buf.getU32());
  return { added, removed };
}
