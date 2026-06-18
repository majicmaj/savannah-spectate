// Voxel terrain: meshes the streamed heightmap into per-chunk blocky geometry,
// textured like the game — grass_top on land tops, grass_side on land cliff
// sides, dirt on river/underwater blocks (top + sides). One Mesh per chunk with
// three material groups (grass_top / grass_side / dirt), built lazily around the
// spectate target and culled beyond CHUNK_RENDER_RADIUS. Water plane follows cam.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import { VOXEL_CHUNK, VOXEL_WATER_LEVEL } from "../world/constants.js";
import { settings } from "../settings.js";

const CHUNK = VOXEL_CHUNK;
const BUILD_PER_FRAME = 3;

// per-block top-face UV rotations (break the obvious grid tiling)
const TOPUV: number[][][] = [
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[1, 0], [1, 1], [0, 1], [0, 0]],
  [[1, 1], [0, 1], [0, 0], [1, 0]],
  [[0, 1], [0, 0], [1, 0], [1, 1]],
];

function loadTex(path: string, repeat = false): THREE.Texture {
  const t = new THREE.TextureLoader().load(path);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function hashRot(x: number, z: number): number {
  let h = (Math.imul(x, 2654435761) ^ Math.imul(z, 40503)) >>> 0;
  return (h >>> 5) & 3;
}

export class Terrain {
  readonly group = new THREE.Group();
  private hm: Heightmap | null = null;
  private mats: THREE.Material[];
  private chunks = new Map<string, THREE.Mesh>();

  constructor() {
    const grassTop = new THREE.MeshToonMaterial({ map: loadTex("/textures/grass_top.png") });
    const grassSide = new THREE.MeshToonMaterial({ map: loadTex("/textures/grass_side.png") });
    const dirt = new THREE.MeshToonMaterial({ map: loadTex("/textures/dirt.png", true) });
    this.mats = [grassTop, grassSide, dirt]; // group indices 0/1/2 (water is its own module)
  }

  setHeightmap(hm: Heightmap): void { this.hm = hm; }
  get ready(): boolean { return !!this.hm?.loaded; }

  update(_dt: number, target: THREE.Vector3 | null): void {
    if (!this.hm?.loaded || !target) return;
    const ccx = Math.floor(target.x / CHUNK);
    const ccz = Math.floor(target.z / CHUNK);
    const R = settings.chunkRadius;

    for (const [key, mesh] of this.chunks) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(cx - ccx) > R + 1 || Math.abs(cz - ccz) > R + 1) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }

    let built = 0;
    for (let ring = 0; ring <= R && built < BUILD_PER_FRAME; ring++) {
      for (let dz = -ring; dz <= ring && built < BUILD_PER_FRAME; dz++) {
        for (let dx = -ring; dx <= ring && built < BUILD_PER_FRAME; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
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
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[][] = [[], [], []]; // 0 grass_top, 1 grass_side, 2 dirt
    const x0 = cx * CHUNK, z0 = cz * CHUNK;

    const face = (
      verts: [number, number, number][], n: [number, number, number],
      uvs: number[][], mat: number,
    ) => {
      const base = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        pos.push(verts[k][0], verts[k][1], verts[k][2]);
        nrm.push(n[0], n[1], n[2]);
        uv.push(uvs[k][0], uvs[k][1]);
      }
      idx[mat].push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = hm.heightAt(x, z);
        const top = h + 1;
        const underwater = h < VOXEL_WATER_LEVEL;
        const topMat = underwater ? 2 : 0;
        const sideMat = underwater ? 2 : 1;

        // top quad — wound CCW from above so the normal points +Y (else the
        // FrontSide material backface-culls it and tops vanish)
        face(
          [[x, top, z], [x, top, z + 1], [x + 1, top, z + 1], [x + 1, top, z]],
          [0, 1, 0], TOPUV[hashRot(x, z)], topMat,
        );

        // exposed cliff sides; grass_side stretches full texture, dirt tiles per block
        const npx = hm.heightAt(x + 1, z);
        if (npx < h) face([[x + 1, npx + 1, z], [x + 1, top, z], [x + 1, top, z + 1], [x + 1, npx + 1, z + 1]],
          [1, 0, 0], this.sideUV2(underwater ? top - (npx + 1) : 1.0, "ab"), sideMat);
        const nnx = hm.heightAt(x - 1, z);
        if (nnx < h) face([[x, nnx + 1, z], [x, nnx + 1, z + 1], [x, top, z + 1], [x, top, z]],
          [-1, 0, 0], this.sideUV2(underwater ? top - (nnx + 1) : 1.0, "bb"), sideMat);
        const npz = hm.heightAt(x, z + 1);
        if (npz < h) face([[x, npz + 1, z + 1], [x + 1, npz + 1, z + 1], [x + 1, top, z + 1], [x, top, z + 1]],
          [0, 0, 1], this.sideUV2(underwater ? top - (npz + 1) : 1.0, "bb"), sideMat);
        const nnz = hm.heightAt(x, z - 1);
        if (nnz < h) face([[x, nnz + 1, z], [x, top, z], [x + 1, top, z], [x + 1, nnz + 1, z]],
          [0, 0, -1], this.sideUV2(underwater ? top - (nnz + 1) : 1.0, "ab"), sideMat);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    const merged = idx[0].concat(idx[1], idx[2]);
    geo.setIndex(merged);
    let off = 0;
    for (let m = 0; m < 3; m++) {
      if (idx[m].length) geo.addGroup(off, idx[m].length, m);
      off += idx[m].length;
    }
    const mesh = new THREE.Mesh(geo, this.mats);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  // UV for a side quad in vertex order [bottom, top, top, bottom] (ab) or
  // [bottom, bottom, top, top] (bb). u runs 0..1 across width, v 0(bottom)..vTop(top).
  private sideUV2(vTop: number, order: "ab" | "bb"): number[][] {
    if (order === "ab") return [[0, 0], [0, vTop], [1, vTop], [1, 0]];
    return [[0, 0], [1, 0], [1, vTop], [0, vTop]];
  }

  chunkCount(): number { return this.chunks.size; }
}
