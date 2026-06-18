// Grass clumps: instanced multi-plane tufts scattered on land within the render
// radius around the spectate target (deterministic per-cell hash; positions
// rebuilt only on movement). Geometry + per-instance transform are ported from
// the game (GrassRender.build_crossed_mesh + net.gd _grass_transform):
//   • mesh: N angled crossed planes + satellite sub-tufts (not 2 flat quads) so
//     each instance reads as a bushy clump from any angle.
//   • transform: per-tuft footprint scale, location-noise height, golden-angle
//     yaw + small tilt, and the base anchored to the LOWEST block under its
//     7×7 m footprint (so tufts sink into a rise instead of floating over a
//     downhill slope), with tilt-induced lift compensated.
// Per-instance alpha (shader-patched) fades tufts to 50% when near the focused
// animal OR between the camera and it, so grass never hides the subject.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import {
  VOXEL_WATER_LEVEL, GRASS_FULL_HEIGHT_M, GRASS_FOOTPRINT_M, GRASS_VISUAL_MIN_M, GRASS_VISUAL_MAX_M,
  GRASS_TINT_DRY_A, GRASS_TINT_DRY_B, GRASS_TINT_WET_A, GRASS_TINT_WET_B,
} from "../world/constants.js";
import { settings } from "../settings.js";

const SPACING = 4.5;
const CAP = 14000;
const TEX = "/textures/GRASS_TRANSPARENT.png";
const NEAR_R = 13; // fade radius around the focused animal (m)
const CORRIDOR = 5.5; // half-width of the camera→animal fade corridor (m)
const FADE_ALPHA = 0.5;

// base crossed-quad mesh dims (game GRASS_BASE_MESH_W/H); per-instance scale maps
// these to the footprint/height. 1.6 m wide × 0.8 m tall (2:1).
const BASE_W = 1.6;
const BASE_H = 0.8;
const TAU = Math.PI * 2;

function hash2(x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// net.gd _grass_hash01: fposmod(sin(fid*12.9898 + salt) * 43758.5453, 1.0)
function ghash(fid: number, salt: number): number {
  const v = (Math.sin(fid * 12.9898 + salt) * 43758.5453) % 1;
  return v < 0 ? v + 1 : v;
}
// generic positive-fract of sin*43758 (GrassRender sub-tuft hashes h0..h4)
function shash(seed: number, off: number): number {
  const v = (Math.sin(seed + off) * 43758.5453) % 1;
  return v < 0 ? v + 1 : v;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Port of net.gd _grass_color: per-blade dry/wet palette + hash jitter + shade.
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

/**
 * Port of GrassRender.build_crossed_mesh: `planes` angled quads spaced around Y,
 * `subs` satellite sub-tufts. Returns the geometry plus the bottom-corner XZ
 * dirs (for tilt-lift compensation in the transform).
 */
function buildClumpMesh(planes: number, subs: number): { geo: THREE.BufferGeometry; bottomDirs: [number, number][] } {
  const n = Math.max(2, planes);
  const nSub = Math.max(1, subs);
  const strideRad = Math.PI / n / nSub;
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  const bottomDirs: [number, number][] = [];

  for (let s = 0; s < nSub; s++) {
    let subOffX = 0, subOffZ = 0, subYaw = s * strideRad, subScale = 1, subHeight = 1;
    if (s > 0) {
      const h0 = shash(s * 17.31, 0.7), h1 = shash(s * 23.45, 1.1), h2 = shash(s * 31.13, 2.3);
      const h3 = shash(s * 41.71, 3.7), h4 = shash(s * 53.92, 4.1);
      const offR = lerp(0.18, 0.36, h4), offTh = h0 * TAU;
      subOffX = Math.cos(offTh) * offR; subOffZ = Math.sin(offTh) * offR;
      subYaw += (h1 - 0.5) * 0.15;
      subScale = lerp(0.55, 1.05, h2);
      subHeight = lerp(0.75, 1.05, h3);
    }
    const sy = Math.sin(subYaw), cy = Math.cos(subYaw);
    for (let i = 0; i < n; i++) {
      const jitter = Math.sin(i * 1.7 + 0.3 + s * 0.9) * 0.30;
      const theta = (i * Math.PI) / n + jitter;
      const tx = Math.cos(theta) * 0.8 * subScale, tz = Math.sin(theta) * 0.8 * subScale;
      const nx = -Math.sin(theta), nz = Math.cos(theta);
      const rtx = cy * tx - sy * tz, rtz = sy * tx + cy * tz;
      const rnx = cy * nx - sy * nz, rnz = sy * nx + cy * nz;
      const planeOffD = Math.sin(i * 1.31 + s * 2.7 + 0.5) * 0.25 * subScale;
      const px = subOffX + rnx * planeOffD, pz = subOffZ + rnz * planeOffD;
      const topY = BASE_H * subHeight;
      const base = pos.length / 3;
      // v0 bottom-left, v1 bottom-right, v2 top-right, v3 top-left
      pos.push(px - rtx, 0, pz - rtz,  px + rtx, 0, pz + rtz,  px + rtx, topY, pz + rtz,  px - rtx, topY, pz - rtz);
      bottomDirs.push([px - rtx, pz - rtz], [px + rtx, pz + rtz]);
      // flat UP normals (like the game) → even top-lit shading, no dark backside
      for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
      const flip = Math.sin(i * 4.11 + s * 7.93 + 1.3) > 0;
      const u0 = flip ? 1 : 0, u1 = flip ? 0 : 1; // root row v=0, tip row v=1
      uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return { geo, bottomDirs };
}

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private hm: Heightmap | null = null;
  private bottomDirs: [number, number][];
  private mat4 = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private eul = new THREE.Euler();
  private scl = new THREE.Vector3();
  private posV = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private lastCellX = NaN;
  private lastCellZ = NaN;
  private posXZ = new Float32Array(CAP * 2); // active instance world x,z (for alpha)
  private alphaAttr: THREE.InstancedBufferAttribute;
  private n = 0;

  constructor() {
    // near-tier clump: 3 planes × 2 sub-tufts (game's closest LOD spec)
    const { geo, bottomDirs } = buildClumpMesh(3, 2);
    this.bottomDirs = bottomDirs;

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP).fill(1), 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("instAlpha", this.alphaAttr);

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

    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
  }

  setHeightmap(hm: Heightmap): void { this.hm = hm; }

  // Port of net.gd _grass_transform (food assumed full → no sink). Writes the
  // instance matrix for slot `n` and returns nothing.
  private writeTransform(slot: number, fid: number, wx: number, wz: number): void {
    const hm = this.hm!;
    // cosmetic footprint size (skewed small via pow 1.7)
    const sizeT = Math.pow(ghash(fid, 91), 1.7);
    const sizeFactor = lerp(GRASS_VISUAL_MIN_M / GRASS_FOOTPRINT_M, GRASS_VISUAL_MAX_M / GRASS_FOOTPRINT_M, sizeT);
    // location-noise height (no POI data here); pow 1.8 squashes toward scrub
    const locN =
      Math.sin(wx * 0.0140 + wz * 0.0210) +
      0.6 * Math.cos(wx * 0.0035 - wz * 0.0090) +
      0.4 * Math.sin(wx * 0.0260 + wz * 0.0190 + 1.7);
    const locT = Math.pow(Math.min(1, Math.max(0, (locN + 2.0) * 0.25)), 1.8);
    const locHeightMul = lerp(0.30, 1.35, locT);
    const heightM = GRASS_FULL_HEIGHT_M * sizeFactor * locHeightMul;

    const sx = (GRASS_FOOTPRINT_M / BASE_W) * sizeFactor;
    const syScale = heightM / BASE_H;
    const yaw = (fid * 2.399963229728653 + ghash(fid, 113) * 0.6) % TAU;
    const tiltX = (ghash(fid, 197) - 0.5) * 0.22;
    const tiltZ = (ghash(fid, 281) - 0.5) * 0.22;

    this.eul.set(tiltX, yaw, tiltZ, "YXZ");
    this.quat.setFromEuler(this.eul);
    this.scl.set(sx, syScale, sx);

    // tilt-induced lift: highest bottom corner after rotation+scale → push down
    let lift = 0;
    for (const d of this.bottomDirs) {
      this.tmp.set(d[0] * sx, 0, d[1] * sx).applyQuaternion(this.quat);
      if (this.tmp.y > lift) lift = this.tmp.y;
    }
    const groundY = hm.lowestInFootprint(wx, wz, GRASS_FOOTPRINT_M) + 1;
    this.posV.set(wx, groundY - lift, wz);
    this.mat4.compose(this.posV, this.quat, this.scl);
    this.mesh.setMatrixAt(slot, this.mat4);
  }

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
        const fid = ((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0) % 1000000;
        this.writeTransform(n, fid, wx, wz);
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
