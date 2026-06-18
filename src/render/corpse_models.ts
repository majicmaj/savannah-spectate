// Corpses rendered with the real meat.glb. The model has a "meat" node group
// (meat_taper/meat_main) and a "bone" node group (bone_shaft + knobs). As the
// carcass is eaten, meat_ratio falls 1→0; we shrink the meat node so the bare
// bone shows, matching the game. Pooled clones (meat.glb is static, few corpses).

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { RenderEnt } from "./world_view.js";

interface Inst { root: THREE.Object3D; meat: THREE.Object3D | null; }

export class CorpseModels {
  readonly group = new THREE.Group();
  private template: THREE.Object3D | null = null;
  private baseScale = 1;
  private free: Inst[] = [];
  private active = new Map<number, Inst>();
  loaded = false;

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync("/models/meat.glb");
    const scene = gltf.scene;
    scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m?.map) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.NearestFilter; m.map.generateMipmaps = false; }
      }
    });
    // normalize like the game's _wrap_normalize_model: center XZ, sit min_y on 0,
    // scale so max(x,z) = 1 → final corpse is `size` m wide (cn.scale = size).
    const box = new THREE.Box3().setFromObject(scene);
    scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const maxXZ = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    this.baseScale = 1 / Math.max(0.001, maxXZ);
    const wrap = new THREE.Group();
    wrap.add(scene);
    this.template = wrap;
    this.loaded = true;
  }

  private acquire(): Inst {
    const pooled = this.free.pop();
    if (pooled) { pooled.root.visible = true; return pooled; }
    const root = skeletonClone(this.template!);
    this.group.add(root);
    return { root, meat: root.getObjectByName("meat") ?? null };
  }

  update(corpses: RenderEnt[]): void {
    if (!this.loaded) return;
    const want = new Set<number>();
    for (const c of corpses) {
      want.add(c.id);
      let inst = this.active.get(c.id);
      if (!inst) { inst = this.acquire(); this.active.set(c.id, inst); }
      inst.root.position.set(c.x, c.y, c.z);
      inst.root.rotation.set(0, c.yaw, 0);
      inst.root.scale.setScalar(this.baseScale * Math.max(0.3, c.size));
      // meat_ratio (c.meat): 1 = full meat, 0 = bone phase (net.gd:39149).
      if (inst.meat) {
        inst.meat.visible = c.meat > 0.02;
        inst.meat.scale.setScalar(Math.max(c.meat, 0.0001));
      }
    }
    for (const [id, inst] of this.active) {
      if (!want.has(id)) { inst.root.visible = false; this.free.push(inst); this.active.delete(id); }
    }
  }

  count(): number { return this.active.size; }
}
