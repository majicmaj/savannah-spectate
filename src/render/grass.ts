// Grass carpet: instanced crossed-quad tufts scattered on land within the render
// radius around the spectate target (deterministic per-cell hash; positions
// rebuilt only on movement). Per-instance alpha (shader-patched) fades tufts to
// 50% when they're near the focused animal OR between the camera and the animal,
// so grass never hides the subject. Underwater cells are skipped via the heightmap.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import {
  VOXEL_WATER_LEVEL, GRASS_FULL_HEIGHT_M, GRASS_WIDTH_M,
  GRASS_TINT_DRY_A, GRASS_TINT_DRY_B, GRASS_TINT_WET_A, GRASS_TINT_WET_B,
} from "../world/constants.js";
import { settings } from "../settings.js";

const SPACING = 4.5;
const CAP = 14000;
const TEX = "/textures/GRASS_TRANSPARENT.png";
const NEAR_R = 13; // fade radius around the focused animal (m)
const CORRIDOR = 5.5; // half-width of the camera→animal fade corridor (m)
const FADE_ALPHA = 0.5;

function hash2(x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// net.gd _grass_hash01: fract(sin(fid*12.9898 + salt) * 43758.5453)
function ghash(fid: number, salt: number): number {
  const v = Math.sin(fid * 12.9898 + salt) * 43758.5453;
  return v - Math.floor(v);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Port of net.gd _grass_color: per-blade dry/wet palette + hash jitter + shade.
// water_t (0..0.5) comes from the heightmap's water proximity. fid is a stable
// per-cell id so a tuft keeps its color as the carpet rebuilds around the target.
function grassTuftColor(fid: number, waterT: number): [number, number, number] {
  const dry = mix3(GRASS_TINT_DRY_A, GRASS_TINT_DRY_B, ghash(fid, 0));
  const wet = mix3(GRASS_TINT_WET_A, GRASS_TINT_WET_B, ghash(fid, 31));
  const c = mix3(dry, wet, waterT);
  const shade = lerp(0.82, 1.18, ghash(fid, 17));
  c[0] *= lerp(0.88, 1.12, ghash(fid, 47)) * shade;
  c[1] *= lerp(0.90, 1.15, ghash(fid, 61)) * shade;
  c[2] *= lerp(0.82, 1.10, ghash(fid, 73)) * shade;
  return c;
}

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private hm: Heightmap | null = null;
  private dummy = new THREE.Object3D();
  private lastCellX = NaN;
  private lastCellZ = NaN;
  private posXZ = new Float32Array(CAP * 2); // active instance world x,z (for alpha)
  private alphaAttr: THREE.InstancedBufferAttribute;
  private n = 0;

  constructor() {
    const w = GRASS_WIDTH_M / 2, h = GRASS_FULL_HEIGHT_M;
    const g = new THREE.BufferGeometry();
    const pos = [
      -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0,
      0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w,
    ];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP).fill(1), 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("instAlpha", this.alphaAttr);

    const tex = new THREE.TextureLoader().load(TEX);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.MeshToonMaterial({
      map: tex, alphaTest: 0.2, side: THREE.DoubleSide, color: 0xffffff, transparent: true,
    });
    // per-instance alpha: multiply diffuse alpha by instAlpha
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = "attribute float instAlpha;\nvarying float vInstAlpha;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\n  vInstAlpha = instAlpha;");
      shader.fragmentShader = "varying float vInstAlpha;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>", "#include <map_fragment>\n  diffuseColor.a *= vInstAlpha;");
    };

    this.mesh = new THREE.InstancedMesh(g, mat, CAP);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
  }

  setHeightmap(hm: Heightmap): void { this.hm = hm; }

  update(target: THREE.Vector3 | null): void {
    if (!this.hm?.loaded || !target) return;
    const cellX = Math.round(target.x / SPACING);
    const cellZ = Math.round(target.z / SPACING);
    if (cellX === this.lastCellX && cellZ === this.lastCellZ) return;
    this.lastCellX = cellX;
    this.lastCellZ = cellZ;

    const R = settings.renderRadiusM, cells = Math.floor(R / SPACING), r2 = R * R;
    let n = 0;
    for (let dz = -cells; dz <= cells && n < CAP; dz++) {
      for (let dx = -cells; dx <= cells && n < CAP; dx++) {
        const gx = (cellX + dx) * SPACING, gz = (cellZ + dz) * SPACING;
        const ddx = gx - target.x, ddz = gz - target.z;
        if (ddx * ddx + ddz * ddz > r2) continue;
        const cx = Math.round(gx), cz = Math.round(gz);
        if (hash2(cx, cz) > 0.82) continue;
        const wx = gx + (hash2(cx + 7, cz) - 0.5) * SPACING;
        const wz = gz + (hash2(cx, cz + 13) - 0.5) * SPACING;
        if (this.hm.heightAt(wx, wz) < VOXEL_WATER_LEVEL) continue;
        const y = this.hm.surfaceAt(wx, wz);
        this.dummy.position.set(wx, y, wz);
        this.dummy.rotation.set(0, hash2(cx + 3, cz + 5) * Math.PI, 0);
        const s = 0.85 + hash2(cx + 1, cz + 2) * 0.3;
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        const fid = ((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0) % 1000000;
        const tc = grassTuftColor(fid, this.hm.grassWaterT(wx, wz));
        this.mesh.setColorAt(n, new THREE.Color(tc[0], tc[1], tc[2]));
        this.posXZ[n * 2] = wx;
        this.posXZ[n * 2 + 1] = wz;
        n++;
      }
    }
    this.n = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Fade tufts near the focused animal or along the camera→animal line. */
  updateAlpha(cam: THREE.Vector3, target: THREE.Vector3 | null): void {
    const a = this.alphaAttr.array as Float32Array;
    if (!target) { for (let i = 0; i < this.n; i++) a[i] = 1; this.alphaAttr.needsUpdate = true; return; }
    const near2 = NEAR_R * NEAR_R, corr2 = CORRIDOR * CORRIDOR;
    const sx = target.x - cam.x, sz = target.z - cam.z;
    const segLen2 = Math.max(1e-4, sx * sx + sz * sz);
    for (let i = 0; i < this.n; i++) {
      const px = this.posXZ[i * 2], pz = this.posXZ[i * 2 + 1];
      let alpha = 1;
      const dtx = px - target.x, dtz = pz - target.z;
      if (dtx * dtx + dtz * dtz < near2) {
        alpha = FADE_ALPHA;
      } else {
        const t = ((px - cam.x) * sx + (pz - cam.z) * sz) / segLen2;
        if (t > 0.05 && t < 0.95) {
          const projx = cam.x + sx * t, projz = cam.z + sz * t;
          const perp = (px - projx) ** 2 + (pz - projz) ** 2;
          if (perp < corr2) alpha = FADE_ALPHA;
        }
      }
      a[i] = alpha;
    }
    this.alphaAttr.needsUpdate = true;
  }

  count(): number { return this.n; }
}
