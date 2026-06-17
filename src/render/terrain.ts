// Voxel terrain: meshes the streamed heightmap into per-chunk blocky geometry
// (top quad + culled cliff sides, vertex-colored per voxel_mesher.gd), built
// lazily around the spectate target and culled beyond CHUNK_RENDER_RADIUS so the
// 1024² world never all renders at once. One Mesh per chunk → frustum-culled by
// three.js; the chase cam only pays for what's in front of it.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import {
  VOXEL_CHUNK, VOXEL_WATER_LEVEL, VOXEL_WATER_SURFACE_OFFSET,
  CHUNK_RENDER_RADIUS, RENDER_RADIUS_M, COL_DIRT,
} from "../world/constants.js";

const CHUNK = VOXEL_CHUNK;
const BUILD_PER_FRAME = 3;

export class Terrain {
  readonly group = new THREE.Group();
  private hm: Heightmap | null = null;
  private mat: THREE.MeshToonMaterial;
  private chunks = new Map<string, THREE.Mesh>();
  private water: THREE.Mesh;

  constructor() {
    this.mat = new THREE.MeshToonMaterial({ vertexColors: true });
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(RENDER_RADIUS_M * 2.4, RENDER_RADIUS_M * 2.4),
      new THREE.MeshToonMaterial({ color: 0x2e6ba0, transparent: true, opacity: 0.82 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = VOXEL_WATER_LEVEL + VOXEL_WATER_SURFACE_OFFSET;
    this.group.add(this.water);
  }

  setHeightmap(hm: Heightmap): void {
    this.hm = hm;
  }
  get ready(): boolean {
    return !!this.hm?.loaded;
  }

  update(_dt: number, target: THREE.Vector3 | null): void {
    if (!this.hm?.loaded || !target) return;
    this.water.position.x = target.x;
    this.water.position.z = target.z;

    const ccx = Math.floor(target.x / CHUNK);
    const ccz = Math.floor(target.z / CHUNK);
    const R = CHUNK_RENDER_RADIUS;

    // cull chunks beyond R+1 (hysteresis to avoid boundary churn)
    for (const [key, mesh] of this.chunks) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(cx - ccx) > R + 1 || Math.abs(cz - ccz) > R + 1) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }

    // build missing chunks within R, nearest first, budgeted per frame
    let built = 0;
    for (let ring = 0; ring <= R && built < BUILD_PER_FRAME; ring++) {
      for (let dz = -ring; dz <= ring && built < BUILD_PER_FRAME; dz++) {
        for (let dx = -ring; dx <= ring && built < BUILD_PER_FRAME; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue; // ring shell only
          const cx = ccx + dx, cz = ccz + dz;
          const key = `${cx},${cz}`;
          if (this.chunks.has(key)) continue;
          const mesh = this.buildChunk(cx, cz);
          this.chunks.set(key, mesh);
          this.group.add(mesh);
          built++;
        }
      }
    }
  }

  private buildChunk(cx: number, cz: number): THREE.Mesh {
    const hm = this.hm!;
    const pos: number[] = [];
    const col: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const x0 = cx * CHUNK, z0 = cz * CHUNK;

    const pushQuad = (
      a: [number, number, number], b: [number, number, number],
      c: [number, number, number], d: [number, number, number],
      n: [number, number, number], rgb: [number, number, number],
    ) => {
      const base = pos.length / 3;
      for (const v of [a, b, c, d]) {
        pos.push(v[0], v[1], v[2]);
        nrm.push(n[0], n[1], n[2]);
        col.push(rgb[0], rgb[1], rgb[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = hm.heightAt(x, z);
        const top = h + 1;
        const tc = hm.topColor(x, z);
        // top quad (CCW from above), y up
        pushQuad([x, top, z], [x + 1, top, z], [x + 1, top, z + 1], [x, top, z + 1], [0, 1, 0], tc);

        const grassSide = h > VOXEL_WATER_LEVEL;
        const sc: [number, number, number] = grassSide
          ? [tc[0] * 0.72, tc[1] * 0.72, tc[2] * 0.62]
          : [...COL_DIRT] as [number, number, number];

        // exposed cliff sides where a neighbor column is lower
        const npx = hm.heightAt(x + 1, z);
        if (npx < h) pushQuad([x + 1, npx + 1, z], [x + 1, top, z], [x + 1, top, z + 1], [x + 1, npx + 1, z + 1], [1, 0, 0], sc);
        const nnx = hm.heightAt(x - 1, z);
        if (nnx < h) pushQuad([x, nnx + 1, z], [x, nnx + 1, z + 1], [x, top, z + 1], [x, top, z], [-1, 0, 0], sc);
        const npz = hm.heightAt(x, z + 1);
        if (npz < h) pushQuad([x, npz + 1, z + 1], [x + 1, npz + 1, z + 1], [x + 1, top, z + 1], [x, top, z + 1], [0, 0, 1], sc);
        const nnz = hm.heightAt(x, z - 1);
        if (nnz < h) pushQuad([x, nnz + 1, z], [x, top, z], [x + 1, top, z], [x + 1, nnz + 1, z], [0, 0, -1], sc);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  chunkCount(): number {
    return this.chunks.size;
  }
}
