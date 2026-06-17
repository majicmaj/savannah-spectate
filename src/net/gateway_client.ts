// WebSocket client for the game's spectator gateway (scripts/net/spectator_gateway.gd).
// Frame wire format: [frame_type u8][payload...]. Each binary WS message is one
// frame. The gateway streams god-view keyframe snapshots at 20 Hz, so every
// snapshot is a complete entity set (no delta baseline needed).

import { decodeSnapshot, type DecodedSnapshot } from "./snapshot_codec.js";

const FRAME_SNAPSHOT = 1;
const FRAME_WORLD_INIT = 2;
const FRAME_WORLD_HEIGHTS = 3;
const FRAME_TIME = 4;

export type SnapshotListener = (snap: DecodedSnapshot) => void;
export type WorldInitListener = (payload: Uint8Array) => void;
export type HeightmapListener = (payload: Uint8Array) => void;
export type TimeListener = (timeOfDay: number) => void;
export type StatusListener = (status: "connecting" | "open" | "closed") => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: number | null = null;
  private closedByUser = false;

  onSnapshot: SnapshotListener | null = null;
  onWorldInit: WorldInitListener | null = null;
  onHeightmap: HeightmapListener | null = null;
  onTime: TimeListener | null = null;
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
