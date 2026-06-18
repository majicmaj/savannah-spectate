// Real GLB animal models with animation, LOD'd to the spectate target. The GLBs
// are node-TRS animated (skins:0) — a hierarchy of rigid part-meshes driven by
// AnimationClips, so each is ~20-50 draw calls and CANNOT be instanced. We bound
// cost by only giving full models to the N entities nearest the followed animal;
// everything else stays as WorldView's instanced capsules.
//
// Clip vocabulary (from the GLBs): idle1/2/3, move, run, attack, eat, jump,
// death, dead, sleep, sleeping, wake (+ vulture flight clips, wildebeest kick).

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ANIMAL_MODELS, LIONESS_MODEL } from "../world/constants.js";
import type { RenderEnt } from "./world_view.js";

// The GLBs are low-poly rigid node-TRS models (cheaper than the capsule), so we
// render them for essentially every on-screen animal instead of the cylinder
// placeholder. High caps with a generous backstop for extreme crowds.
const MAX_MODELS = 200; // nearest-to-target entities that get a full GLB
const MAX_DIST = 340; // covers the render radius; beyond it, capsule fallback
const RUN_SPEED = 5.0; // m/s threshold for run vs walk

interface Template {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  baseScale: number; // multiply by entity.size to get world scale
}

interface Inst {
  path: string;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
}

function firstClip(actions: Map<string, THREE.AnimationAction>, names: string[]): string {
  for (const n of names) if (actions.has(n)) return n;
  return names[names.length - 1];
}

function pickClip(e: RenderEnt, actions: Map<string, THREE.AnimationAction>, isVulture: boolean): string {
  if (isVulture && e.flightMode > 0) return firstClip(actions, ["fly", "glide", "move", "run"]);
  if (e.sleeping || e.aiState === 14 || e.aiState === 15) return firstClip(actions, ["sleeping", "sleep", "idle1"]);
  if (e.aiState === 4 || e.aiState === 16) return firstClip(actions, ["eat", "idle1"]); // feast / graze
  if (e.aiState === 20) return firstClip(actions, ["attack", "idle1"]);
  if (e.speed > RUN_SPEED) return firstClip(actions, ["run", "move"]);
  if (e.speed > 0.4) return firstClip(actions, ["move", "walk", "run"]);
  // gentle idle variety by id
  return firstClip(actions, [["idle1", "idle2", "idle3"][e.id % 3], "idle1"]);
}

export class AnimalModels {
  readonly group = new THREE.Group();
  private templates = new Map<string, Template>();
  private free = new Map<string, THREE.Object3D[]>(); // path -> pooled roots
  private freeInst = new Map<THREE.Object3D, Inst>();
  private active = new Map<number, Inst>(); // entity id -> inst
  readonly suppressed = new Set<number>();
  loaded = false;

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const paths = new Set<string>([...Object.values(ANIMAL_MODELS), LIONESS_MODEL]);
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(
      [...paths].map(
        (p) =>
          new Promise<void>((resolve) => {
            loader.load(
              "/" + p,
              (gltf) => {
                const scene = gltf.scene;
                this.applyPixelArt(scene);
                const box = new THREE.Box3().setFromObject(scene);
                const h = Math.max(0.001, box.max.y - box.min.y);
                // entity.size ≈ body length/height in meters; scale model so its
                // native height maps to ~size. Tunable per-feel.
                this.templates.set(p, { scene, clips: gltf.animations, baseScale: 1 / h });
                done++;
                onProgress?.(done, paths.size);
                resolve();
              },
              undefined,
              (err) => {
                console.error(`[models] failed to load ${p}`, err);
                done++;
                onProgress?.(done, paths.size);
                resolve();
              },
            );
          }),
      ),
    );
    this.loaded = true;
  }

  private applyPixelArt(root: THREE.Object3D): void {
    root.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m && m.map) {
            m.map.magFilter = THREE.NearestFilter;
            m.map.minFilter = THREE.NearestFilter;
            m.map.generateMipmaps = false;
            m.map.needsUpdate = true;
          }
        }
      }
    });
  }

  private modelPath(e: RenderEnt): string {
    if (e.animal === 0 && e.isFemale) return LIONESS_MODEL;
    return ANIMAL_MODELS[e.animal] ?? ANIMAL_MODELS[0];
  }

  private acquire(path: string): Inst | null {
    const tmpl = this.templates.get(path);
    if (!tmpl) return null;
    const pool = this.free.get(path);
    if (pool && pool.length) {
      const root = pool.pop()!;
      root.visible = true;
      return this.freeInst.get(root)!;
    }
    const root = skeletonClone(tmpl.scene);
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of tmpl.clips) {
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      actions.set(clip.name, a);
    }
    const inst: Inst = { path, root, mixer, actions, current: "" };
    this.freeInst.set(root, inst);
    this.group.add(root);
    return inst;
  }

  private release(id: number): void {
    const inst = this.active.get(id);
    if (!inst) return;
    this.active.delete(id);
    inst.root.visible = false;
    const pool = this.free.get(inst.path) ?? [];
    pool.push(inst.root);
    this.free.set(inst.path, pool);
  }

  update(dt: number, target: THREE.Vector3 | null, ents: RenderEnt[]): void {
    this.suppressed.clear();
    if (!this.loaded || !target) return;

    // nearest non-corpse entities to the spectate target
    const cand = ents
      .filter((e) => !e.isCorpse)
      .map((e) => ({ e, d: (e.x - target.x) ** 2 + (e.z - target.z) ** 2 }))
      .filter((c) => c.d < MAX_DIST * MAX_DIST)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_MODELS);

    const want = new Set<number>(cand.map((c) => c.e.id));

    // release models no longer wanted
    for (const id of [...this.active.keys()]) if (!want.has(id)) this.release(id);

    for (const { e } of cand) {
      const path = this.modelPath(e);
      let inst = this.active.get(e.id);
      if (inst && inst.path !== path) {
        this.release(e.id); // species/sex changed — swap model
        inst = undefined;
      }
      if (!inst) {
        const got = this.acquire(path);
        if (!got) continue;
        inst = got;
        this.active.set(e.id, inst);
      }
      const tmpl = this.templates.get(path)!;
      inst.root.position.set(e.x, e.y, e.z);
      inst.root.rotation.set(0, e.yaw, 0);
      const s = tmpl.baseScale * Math.max(0.3, e.size);
      inst.root.scale.setScalar(s);

      const desired = pickClip(e, inst.actions, path === ANIMAL_MODELS[6]);
      if (desired !== inst.current) {
        const next = inst.actions.get(desired);
        if (next) {
          const prev = inst.current ? inst.actions.get(inst.current) : undefined;
          next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
          prev?.fadeOut(0.25);
          inst.current = desired;
        }
      }
      inst.mixer.update(dt);
      this.suppressed.add(e.id);
    }
  }

  activeCount(): number {
    return this.active.size;
  }
}
