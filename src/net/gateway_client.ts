// WebSocket client for the game's spectator gateway (scripts/net/spectator_gateway.gd).
// Frame wire format: [frame_type u8][payload...]. Each binary WS message is one
// frame. The gateway streams god-view keyframe snapshots at 20 Hz, so every
// snapshot is a complete entity set (no delta baseline needed).

import { decodeSnapshot, type DecodedSnapshot } from "./snapshot_codec.js";

const FRAME_SNAPSHOT = 1;
const FRAME_WORLD_INIT = 2;
const FRAME_WORLD_HEIGHTS = 3;
const FRAME_TIME = 4;
const FRAME_ROSTER = 5;
const FRAME_WORLD_TREES = 6;

export interface RosterEntry { name: string; isPlayer: boolean; }
export type RosterListener = (roster: Map<number, RosterEntry>) => void;

// One acacia from the server's authoritative TreeGen set (matches _spawn_trees).
export interface TreeXform { x: number; z: number; s: number; sy: number; ry: number; tx: number; tz: number; }
export type TreesListener = (trees: TreeXform[]) => void;

export type SnapshotListener = (snap: DecodedSnapshot) => void;
export type WorldInitListener = (payload: Uint8Array) => void;
export type HeightmapListener = (payload: Uint8Array) => void;
export type TimeListener = (timeOfDay: number) => void;
export type StatusListener = (status: "connecting" | "open" | "closed") => void;

// FRAME_WORLD_TREES: [u8 ver=1][u16 count] then per tree 7×f32 (x,z,s,sy,ry,tx,tz), little-endian.
// Sent once on connect; lets the viewer match the game's exact forest instead of
// approximating with its own PRNG.
function decodeTrees(payload: Uint8Array): TreeXform[] {
  const out: TreeXform[] = [];
  if (payload.byteLength < 3) return out;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let o = 0;
  const ver = dv.getUint8(o); o += 1;
  if (ver !== 1) { console.error(`[spectate] world_trees version mismatch: got ${ver}`); return out; }
  const count = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < count; i++) {
    if (o + 28 > payload.byteLength) break;
    out.push({
      x: dv.getFloat32(o, true),
      z: dv.getFloat32(o + 4, true),
      s: dv.getFloat32(o + 8, true),
      sy: dv.getFloat32(o + 12, true),
      ry: dv.getFloat32(o + 16, true),
      tx: dv.getFloat32(o + 20, true),
      tz: dv.getFloat32(o + 24, true),
    });
    o += 28;
  }
  return out;
}

// FRAME_ROSTER: [u16 count] then per entity [u32 id][u8 flags][u8 nameLen][name UTF-8]
function decodeRoster(payload: Uint8Array): Map<number, RosterEntry> {
  const out = new Map<number, RosterEntry>();
  if (payload.byteLength < 2) return out;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const dec = new TextDecoder();
  let o = 0;
  const count = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < count; i++) {
    if (o + 6 > payload.byteLength) break;
    const id = dv.getUint32(o, true); o += 4;
    const flags = payload[o]; o += 1;
    const nlen = payload[o]; o += 1;
    if (o + nlen > payload.byteLength) break;
    const name = nlen ? dec.decode(payload.subarray(o, o + nlen)) : "";
    o += nlen;
    out.set(id, { name, isPlayer: (flags & 1) !== 0 });
  }
  return out;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: number | null = null;
  private closedByUser = false;

  onSnapshot: SnapshotListener | null = null;
  onWorldInit: WorldInitListener | null = null;
  onHeightmap: HeightmapListener | null = null;
  onTime: TimeListener | null = null;
  onRoster: RosterListener | null = null;
  onTrees: TreesListener | null = null;
  onStatus: StatusListener | null = null;

  // diagnostics
  snapshotCount = 0;
  lastSnapshotAt = 0;
  bytesPerSec = 0;
  private byteAccum = 0;
  private byteWindowStart = 0;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.onStatus?.("connecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => this.onStatus?.("open");
    ws.onclose = () => {
      this.onStatus?.("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => this.handleFrame(ev.data as ArrayBuffer);
  }

  private handleFrame(data: ArrayBuffer): void {
    if (data.byteLength < 1) return;
    const bytes = new Uint8Array(data);
    const type = bytes[0];
    const payload = bytes.subarray(1);

    const now = performance.now();
    this.byteAccum += data.byteLength;
    if (now - this.byteWindowStart >= 1000) {
      this.bytesPerSec = this.byteAccum / ((now - this.byteWindowStart) / 1000);
      this.byteAccum = 0;
      this.byteWindowStart = now;
    }

    if (type === FRAME_SNAPSHOT) {
      const snap = decodeSnapshot(payload); // god-view keyframes → no baseline
      if (snap) {
        this.snapshotCount++;
        this.lastSnapshotAt = now;
        this.onSnapshot?.(snap);
      }
    } else if (type === FRAME_WORLD_INIT) {
      this.onWorldInit?.(payload);
    } else if (type === FRAME_WORLD_HEIGHTS) {
      this.onHeightmap?.(payload);
    } else if (type === FRAME_TIME) {
      if (payload.byteLength >= 4) {
        const t = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getFloat32(0, true);
        this.onTime?.(t);
      }
    } else if (type === FRAME_ROSTER) {
      this.onRoster?.(decodeRoster(payload));
    } else if (type === FRAME_WORLD_TREES) {
      this.onTrees?.(decodeTrees(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, 1000);
  }

  /** Uplink the spectate-target position so the server anchors AI/physics LOD
   * there → bots near the camera tick at full rate (smooth) instead of the
   * ~2 Hz far-bot step. Frame: [type=1 u8][x f32][z f32] little-endian. */
  sendCenter(x: number, z: number): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buf = new ArrayBuffer(9);
    const dv = new DataView(buf);
    dv.setUint8(0, 1);
    dv.setFloat32(1, x, true);
    dv.setFloat32(5, z, true);
    ws.send(buf);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}
