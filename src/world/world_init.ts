// Decoder for the gateway's FRAME_WORLD_INIT payload (net.gd _encode_world_init_binary,
// WORLD_INIT_VERSION 7). Little-endian. We only need the named-POI block (for biome
// tinting); the water-hole block is parsed to advance past it. Strings are u8-len + UTF-8.

export interface Poi {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

const WORLD_INIT_VERSION = 7;

export interface WorldInit {
  pois: Poi[];
}

export function decodeWorldInit(payload: Uint8Array): WorldInit | null {
  if (payload.byteLength < 3) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const dec = new TextDecoder();
  let o = 0;
  const ver = dv.getUint8(o); o += 1;
  if (ver !== WORLD_INIT_VERSION) {
    console.error(`[spectate] world_init version mismatch: got ${ver}, want ${WORLD_INIT_VERSION}`);
    return null;
  }
  // water-hole block: u16 count, then per hole u32 id + 5×f32 + 2×u8 (30 B)
  const waterN = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < waterN; i++) {
    if (o + 30 > payload.byteLength) return { pois: [] };
    o += 30;
  }
  // named-POI block: u16 count, then per POI 3 strings + 4×f32
  const pois: Poi[] = [];
  if (o + 2 > payload.byteLength) return { pois };
  const poiN = dv.getUint16(o, true); o += 2;
  const readStr = (): string => {
    if (o + 1 > payload.byteLength) return "";
    const n = dv.getUint8(o); o += 1;
    if (o + n > payload.byteLength) return "";
    const s = n ? dec.decode(payload.subarray(o, o + n)) : "";
    o += n;
    return s;
  };
  for (let i = 0; i < poiN; i++) {
    const id = readStr();
    const kind = readStr();
    const name = readStr();
    if (o + 16 > payload.byteLength) break;
    const x = dv.getFloat32(o, true); o += 4;
    const y = dv.getFloat32(o, true); o += 4;
    const z = dv.getFloat32(o, true); o += 4;
    const radius = dv.getFloat32(o, true); o += 4;
    pois.push({ id, kind, name, x, y, z, radius });
  }
  return { pois };
}
