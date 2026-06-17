// Acacia trees: the GLB is static (no animation) and ~93 part-meshes, so we bake
// it into one merged geometry per material and render all trees as a single
// InstancedMesh (1-2 draw calls total). Positions use a seeded RNG scatter on
// land (approximate — not the exact TreeGen set, but the same look), rejecting
// underwater cells via the streamed heightmap.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Heightmap } from "../world/heightmap.js";
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

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync("/" + TREE_MODEL);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    // bbox for scale normalization
    const box = new THREE.Box3().setFromObject(scene);
    const nativeH = Math.max(0.001, box.max.y - box.min.y);
    this.baseScale = 6.0 / nativeH; // s=1 → ~6 m; game scales 1..4 on top

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
      const inst = new THREE.InstancedMesh(merged, list[0].mat, TREE_COUNT + 8);
      inst.castShadow = true;
      inst.frustumCulled = false;
      inst.count = 0;
      this.instMeshes.push(inst);
      this.group.add(inst);
    }
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
}
