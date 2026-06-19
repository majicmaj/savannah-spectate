// Acacia trees: the GLB is static (no animation) and ~93 part-meshes, so we bake
// it into one merged geometry per material and render all trees as a single
// InstancedMesh (1-2 draw calls total). The authoritative positions come from
// the gateway (placeExact) so the forest matches the game's seeded TreeGen + POI
// groves exactly; place() is a PRNG fallback used only against an old gateway.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Heightmap } from "../world/heightmap.js";
import type { TreeXform } from "../net/gateway_client.js";
import {
  TREE_SEED, TREE_COUNT, TREE_MODEL, WORLD_HALF, VOXEL_WATER_LEVEL,
} from "../world/constants.js";

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MatGroup {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

export class Trees {
  readonly group = new THREE.Group();
  private instMeshes: THREE.InstancedMesh[] = [];
  private baseScale = 1;
  private placed = false;
  private topLocal = 1; // local-space height of the canopy top (for sway falloff)
  // shared wind uniforms — trees sway MUCH less than grass (tops only, base fixed)
  private wind = {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStr: { value: 0.8 },
    uTreeTop: { value: 1 },
  };

  /** Per-frame wind for sway. dir is a normalized XZ direction, str ~0..2. */
  setWind(t: number, dir: THREE.Vector2, str: number): void {
    this.wind.uTime.value = t;
    this.wind.uWindDir.value.copy(dir);
    this.wind.uWindStr.value = str;
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync("/" + TREE_MODEL);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    // bbox for scale normalization
    const box = new THREE.Box3().setFromObject(scene);
    const nativeH = Math.max(0.001, box.max.y - box.min.y);
    this.baseScale = 6.0 / nativeH; // s=1 → ~6 m; game scales 1..4 on top
    this.topLocal = box.max.y; // canopy top in merged-geometry local space
    this.wind.uTreeTop.value = this.topLocal;

    // collect geometries grouped by material (apply world transform, pixel-art tex)
    const groups = new Map<string, MatGroup[]>();
    scene.traverse((o: any) => {
      if (!o.isMesh || !o.geometry) return;
      const mat: THREE.Material = Array.isArray(o.material) ? o.material[0] : o.material;
      const anyMat = mat as any;
      if (anyMat.map) {
        anyMat.map.magFilter = THREE.NearestFilter;
        anyMat.map.minFilter = THREE.NearestFilter;
        anyMat.map.generateMipmaps = false;
      }
      const g: THREE.BufferGeometry = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      // normalize attributes so merge succeeds
      if (!g.getAttribute("normal")) g.computeVertexNormals();
      if (!g.getAttribute("uv")) {
        const n = g.getAttribute("position").count;
        g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      }
      // keep only position/normal/uv for a clean merge
      const clean = new THREE.BufferGeometry();
      clean.setAttribute("position", g.getAttribute("position"));
      clean.setAttribute("normal", g.getAttribute("normal"));
      clean.setAttribute("uv", g.getAttribute("uv"));
      if (g.index) clean.setIndex(g.index);
      const key = mat.uuid;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push({ geo: clean, mat });
    });

    for (const list of groups.values()) {
      const merged = mergeGeometries(list.map((l) => l.geo), false);
      if (!merged) continue;
      this.applySway(list[0].mat);
      const inst = new THREE.InstancedMesh(merged, list[0].mat, TREE_COUNT + 8);
      inst.castShadow = true;
      inst.frustumCulled = false;
      inst.count = 0;
      this.instMeshes.push(inst);
      this.group.add(inst);
    }
  }

  // Inject a subtle canopy sway into a tree material: only the upper geometry
  // leans downwind (base fixed), at a fraction of the grass amplitude and a
  // slower rate, so trees read as gently dancing rather than whipping.
  private applySway(mat: THREE.Material): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.wind.uTime;
      shader.uniforms.uWindDir = this.wind.uWindDir;
      shader.uniforms.uWindStr = this.wind.uWindStr;
      shader.uniforms.uTreeTop = this.wind.uTreeTop;
      shader.vertexShader =
        "uniform float uTime, uWindStr, uTreeTop;\nuniform vec2 uWindDir;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  {
    float _sx = length(instanceMatrix[0].xyz);
    vec3 _iwp = instanceMatrix[3].xyz;
    float _hf = clamp(transformed.y / uTreeTop, 0.0, 1.0); // 0 trunk base → 1 canopy top
    _hf = _hf * _hf;                                       // bias sway into the crown
    float _ph = dot(_iwp.xz, uWindDir) * 0.06 - uTime * 0.5;
    float _gust = sin(_ph) * 0.6 + sin(_ph * 1.7 + 1.1) * 0.4;
    float _lean = _gust * uWindStr * 0.22 * _hf;           // world m — ~1/5 of grass
    transformed.x += (uWindDir.x * _lean) / _sx;
    transformed.z += (uWindDir.y * _lean) / _sx;
  }`);
    };
    mat.needsUpdate = true;
  }

  /** Place trees once the heightmap is available. */
  place(hm: Heightmap): void {
    if (this.placed || !hm.loaded || this.instMeshes.length === 0) return;
    const rng = mulberry32(TREE_SEED);
    const dummy = new THREE.Object3D();
    const TAU = Math.PI * 2;
    let placed = 0;
    let attempts = 0;
    const xforms: THREE.Matrix4[] = [];
    while (placed < TREE_COUNT && attempts < TREE_COUNT * 30) {
      attempts++;
      const x = rng() * (WORLD_HALF * 2) - WORLD_HALF;
      const z = rng() * (WORLD_HALF * 2) - WORLD_HALF;
      const s = 1.0 + rng() * 3.0;
      const ry = rng() * TAU;
      if (hm.heightAt(x, z) < VOXEL_WATER_LEVEL) continue; // not in water
      dummy.position.set(x, hm.surfaceAt(x, z), z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.setScalar(s * this.baseScale);
      dummy.updateMatrix();
      xforms.push(dummy.matrix.clone());
      placed++;
    }
    for (const inst of this.instMeshes) {
      for (let i = 0; i < xforms.length; i++) inst.setMatrixAt(i, xforms[i]);
      inst.count = xforms.length;
      inst.instanceMatrix.needsUpdate = true;
    }
    this.placed = true;
    console.log(`[trees] placed ${placed} acacias (baseScale ${this.baseScale.toFixed(3)})`);
  }

  get isPlaced(): boolean { return this.placed; }

  /** Place trees from the server's authoritative TreeGen set (exact positions,
   *  per-tree non-uniform scale + yaw + tilt) so the forest lines up with the
   *  game. Mirrors the _spawn_trees basis: yaw(Y) → tilt(X,Z) → scale(s,sy,s). */
  placeExact(trees: TreeXform[], hm: Heightmap): void {
    if (!hm.loaded || this.instMeshes.length === 0 || trees.length === 0) return;
    this.ensureCapacity(trees.length);
    const dummy = new THREE.Object3D();
    dummy.rotation.order = "YXZ"; // yaw first, then small tilt — tilt is ~±0.08 rad
    const xforms: THREE.Matrix4[] = [];
    for (const t of trees) {
      dummy.position.set(t.x, hm.surfaceAt(t.x, t.z), t.z);
      dummy.rotation.set(t.tx, t.ry, t.tz);
      dummy.scale.set(t.s * this.baseScale, t.sy * this.baseScale, t.s * this.baseScale);
      dummy.updateMatrix();
      xforms.push(dummy.matrix.clone());
    }
    for (const inst of this.instMeshes) {
      for (let i = 0; i < xforms.length; i++) inst.setMatrixAt(i, xforms[i]);
      inst.count = xforms.length;
      inst.instanceMatrix.needsUpdate = true;
    }
    this.placed = true;
    console.log(`[trees] placed ${trees.length} acacias from server (exact)`);
  }

  // The server forest (TreeGen + POI groves) can exceed the load()-time capacity;
  // grow each InstancedMesh in place, reusing the merged geometry + sway material.
  private ensureCapacity(n: number): void {
    if (this.instMeshes.length === 0) return;
    if (n <= this.instMeshes[0].instanceMatrix.count) return;
    const fresh: THREE.InstancedMesh[] = [];
    for (const old of this.instMeshes) {
      const inst = new THREE.InstancedMesh(old.geometry, old.material, n);
      inst.castShadow = true;
      inst.frustumCulled = false;
      inst.count = 0;
      this.group.remove(old);
      old.dispose();
      this.group.add(inst);
      fresh.push(inst);
    }
    this.instMeshes = fresh;
  }
}
