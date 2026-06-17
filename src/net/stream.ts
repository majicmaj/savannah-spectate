// Little-endian byte reader mirroring Godot's StreamPeerBuffer (big_endian=false)
// read methods used by snapshot_codec.gd: get_u8/get_u16/get_u32/get_8/get_float/get_data.
// All multi-byte reads advance the cursor; reads past EOF return 0 (matching
// Godot's silent-zero behavior that the codec's _check_decode_n guards against).

export class ByteReader {
  private view: DataView;
  private pos = 0;
  private len: number;

  constructor(buf: ArrayBuffer | Uint8Array) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.len = u8.byteLength;
  }

  get available(): number {
    return Math.max(0, this.len - this.pos);
  }

  getU8(): number {
    if (this.pos + 1 > this.len) return 0;
    return this.view.getUint8(this.pos++);
  }

  // signed int8 — Godot's get_8()
  getS8(): number {
    if (this.pos + 1 > this.len) return 0;
    return this.view.getInt8(this.pos++);
  }

  getU16(): number {
    if (this.pos + 2 > this.len) return 0;
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  getU32(): number {
    if (this.pos + 4 > this.len) return 0;
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  getFloat(): number {
    if (this.pos + 4 > this.len) return 0;
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  getData(n: number): Uint8Array {
    const end = Math.min(this.pos + n, this.len);
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, end - this.pos);
    this.pos = end;
    return new Uint8Array(out); // copy so callers can hold it past further reads
  }

  getUtf8(n: number): string {
    return new TextDecoder().decode(this.getData(n));
  }
}
