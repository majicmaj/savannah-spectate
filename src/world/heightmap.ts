// Holds the voxel heightmap streamed from the gateway (FRAME_WORLD_HEIGHTS:
// [u16 W][u16 H][W*H u8], Z-outer/X-inner over centered coords [-half, half-1]).
// Also computes a toroidal water-distance field (multi-source BFS) so terrain
// tops fade green→dry with distance from water, matching voxel_mesher.gd.

import {
  VOXEL_WATER_LEVEL, VOXEL_DRY_FALLOFF, WATER_DIST_MAX,
  COL_GRASS_GREEN, COL_GRASS_DRY, COL_SAND, COL_MUD,
} from "./constants.js";

function lerp3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export class Heightmap {
  W = 0;
  H = 0;
  half = 0;
  heights: Uint8Array = new Uint8Array(0);
  private waterDist: Uint8Array = new Uint8Array(0);
  loaded = false;

  ingest(payload: Uint8Array): void {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    this.W = dv.getUint16(0, true);
    this.H = dv.getUint16(2, true);
    this.half = this.W >> 1;
    this.heights = payload.subarray(4, 4 + this.W * this.H);
    this.computeWaterDist();
    this.loaded = true;
    console.log(`[terrain] heightmap ${this.W}x${this.H} ingested (${this.heights.length} cells)`);
  }

  private xi(x: number): number {
    let i = (Math.floor(x) + this.half) % this.W;
    if (i < 0) i += this.W;
    return i;
  }
  private zi(z: number): number {
    let i = (Math.floor(z) + this.half) % this.H;
    if (i < 0) i += this.H;
    return i;
  }

  /** Voxel column height at centered world (x,z). */
  heightAt(x: number, z: number): number {
    if (!this.loaded) return VOXEL_WATER_LEVEL + 1;
    return this.heights[this.zi(z) * this.W + this.xi(x)];
  }

  /** Surface y (top of the block) — entities' server py sit ~here. */
  surfaceAt(x: number, z: number): number {
    return this.heightAt(x, z) + 1;
  }

  /** Per-column top color [r,g,b] per voxel_mesher._top_color_for. */
  topColor(x: number, z: number): [number, number, number] {
    const h = this.heightAt(x, z);
    if (h < VOXEL_WATER_LEVEL) return [...COL_MUD] as [number, number, number];
    if (h <= VOXEL_WATER_LEVEL) return [...COL_SAND] as [number, number, number];
    const d = this.waterDist[this.zi(z) * this.W + this.xi(x)];
    const dryT = Math.min(1, d / VOXEL_DRY_FALLOFF);
    return lerp3(COL_GRASS_GREEN, COL_GRASS_DRY, dryT);
  }

  private computeWaterDist(): void {
    const N = this.W * this.H;
    const dist = new Uint8Array(N).fill(255);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) {
      if (this.heights[i] < VOXEL_WATER_LEVEL) {
        dist[i] = 0;
        queue[qt++] = i;
      }
    }
    const W = this.W, H = this.H;
    while (qh < qt) {
      const i = queue[qh++];
      const d = dist[i];
      if (d >= WATER_DIST_MAX) continue;
      const x = i % W, z = (i / W) | 0;
      // toroidal 4-neighborhood
      const nb = [
        ((x + 1) % W) + z * W,
        ((x - 1 + W) % W) + z * W,
        x + ((z + 1) % H) * W,
        x + ((z - 1 + H) % H) * W,
      ];
      for (const j of nb) {
        if (dist[j] > d + 1) {
          dist[j] = d + 1;
          queue[qt++] = j;
        }
      }
    }
    this.waterDist = dist;
  }
}
