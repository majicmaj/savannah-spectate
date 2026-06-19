// Holds the voxel heightmap streamed from the gateway (FRAME_WORLD_HEIGHTS:
// [u16 W][u16 H][W*H u8], Z-outer/X-inner over centered coords [-half, half-1]).
// Also computes a toroidal water-distance field (multi-source BFS) so terrain
// tops fade green→dry with distance from water, matching voxel_mesher.gd.

import {
  VOXEL_WATER_LEVEL, VOXEL_DRY_FALLOFF, WATER_DIST_MAX,
  COL_GRASS_GREEN, COL_GRASS_DRY, COL_SAND, COL_MUD,
  GRASS_WATER_GREEN_FALLOFF, GRASS_TINT_WATER_SCALE, GRASS_DRY_MID, GRASS_WET_MID,
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

  /**
   * Lowest voxel-column height across an `fp`×`fp` m footprint centered on (x,z).
   * Mirrors GrassGen.lowest_height_in_footprint: a tuft anchors to the lowest
   * block it touches so it sinks into a rise instead of floating over a slope.
   */
  lowestInFootprint(x: number, z: number, fp: number): number {
    if (!this.loaded) return VOXEL_WATER_LEVEL;
    const half = fp * 0.5;
    const x0 = Math.floor(x - half), x1 = Math.floor(x + half);
    const z0 = Math.floor(z - half), z1 = Math.floor(z + half);
    let hMin = this.heightAt(x0, z0);
    for (let xi = x0; xi <= x1; xi++) {
      for (let zi = z0; zi <= z1; zi++) {
        const h = this.heightAt(xi, zi);
        if (h < hMin) hMin = h;
      }
    }
    return hMin;
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

  /** Meters to the nearest water voxel (toroidal BFS, capped at WATER_DIST_MAX). */
  waterDistAt(x: number, z: number): number {
    if (!this.loaded) return WATER_DIST_MAX;
    return this.waterDist[this.zi(z) * this.W + this.xi(x)];
  }

  /** Water-proximity factor 0(dry)..GRASS_TINT_WATER_SCALE(wet) — net.gd _water_bank_factor×SCALE. */
  grassWaterT(x: number, z: number): number {
    const d = this.waterDistAt(x, z);
    return (1 - Math.min(1, d / GRASS_WATER_GREEN_FALLOFF)) * GRASS_TINT_WATER_SCALE;
  }

  /** Raw water-bank proximity 0(dry)..1(at water), unscaled — the water_bank_mask.r
   *  the live ground shader needs so it can apply the seasonal (1-dryness) gate. */
  grassBankFactor(x: number, z: number): number {
    return 1 - Math.min(1, this.waterDistAt(x, z) / GRASS_WATER_GREEN_FALLOFF);
  }

  /** Ground voxel grass palette = mix(dry_mid, wet_mid, water_t) (voxel_top/side shaders). */
  grassGroundColor(x: number, z: number): [number, number, number] {
    return lerp3(GRASS_DRY_MID, GRASS_WET_MID, this.grassWaterT(x, z));
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
