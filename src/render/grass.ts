// Grass carpet: instanced crossed-quad tufts scattered on land within the render
// radius around the spectate target. Positions are a deterministic per-cell hash
// (stable as the camera moves) rather than the exact GrassGen set — for a spectate
// backdrop the look is identical and it stays self-contained + cheap (1 draw call).
// Underwater cells are skipped via the streamed heightmap.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import { VOXEL_WATER_LEVEL, RENDER_RADIUS_M } from "../world/constants.js";

const SPACING = 4.5; // m between candidate tufts
const CAP = 14000; // instance budget (1 draw call)
const TEX = "/textures/GRASS_sm.png";

function hash2(x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private hm: Heightmap | null = null;
  private dummy = new THREE.Object3D();
  private lastCellX = NaN;
  private lastCellZ = NaN;

  constructor() {
    // two crossed quads, base at y=0, ~1.3 m tall
    const w = 0.7, h = 1.3;
    const g = new THREE.BufferGeometry();
    const pos = [
      -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0, // quad A (XY)
      0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w, // quad B (ZY)
    ];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    const tex = new THREE.TextureLoader().load(TEX);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.MeshToonMaterial({
      map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xffffff,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, CAP);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
  }

  setHeightmap(hm: Heightmap): void {
    this.hm = hm;
  }

  update(target: THREE.Vector3 | null): void {
    if (!this.hm?.loaded || !target) return;
    const cellX = Math.round(target.x / SPACING);
    const cellZ = Math.round(target.z / SPACING);
    if (cellX === this.lastCellX && cellZ === this.lastCellZ) return; // only rebuild on movement
    this.lastCellX = cellX;
    this.lastCellZ = cellZ;

    const R = RENDER_RADIUS_M;
    const cells = Math.floor(R / SPACING);
    const r2 = R * R;
    let n = 0;
    for (let dz = -cells; dz <= cells && n < CAP; dz++) {
      for (let dx = -cells; dx <= cells && n < CAP; dx++) {
        const gx = (cellX + dx) * SPACING;
        const gz = (cellZ + dz) * SPACING;
        const ddx = gx - target.x, ddz = gz - target.z;
        if (ddx * ddx + ddz * ddz > r2) continue;
        const cx = Math.round(gx), cz = Math.round(gz);
        const keep = hash2(cx, cz);
        if (keep > 0.82) continue; // thin out a touch
        const jx = (hash2(cx + 7, cz) - 0.5) * SPACING;
        const jz = (hash2(cx, cz + 13) - 0.5) * SPACING;
        const wx = gx + jx, wz = gz + jz;
        if (this.hm.heightAt(wx, wz) < VOXEL_WATER_LEVEL) continue; // no grass underwater
        const y = this.hm.surfaceAt(wx, wz);
        this.dummy.position.set(wx, y, wz);
        this.dummy.rotation.set(0, hash2(cx + 3, cz + 5) * Math.PI, 0);
        const s = 0.7 + hash2(cx + 1, cz + 2) * 0.8;
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        const tc = this.hm.topColor(wx, wz);
        this.mesh.setColorAt(n, new THREE.Color(tc[0] * 1.3, tc[1] * 1.4, tc[2] * 1.1));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  count(): number {
    return this.mesh.count;
  }
}
