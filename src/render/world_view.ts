// Renders decoded snapshot entities as per-species InstancedMesh batches — the
// whole herd costs ~1 draw call per species (the perf thesis in action). PoC uses
// capsule placeholders; swapping in instanced-skinned GLBs (agargaro/instanced-mesh)
// is a drop-in replacement of the geometry/material per species.
//
// Coord map: both Godot and Three.js are right-handed Y-up with -Z forward, so
// snapshot (px,py,pz)->(x,y,z) and yaw->rotation.y map directly.

import * as THREE from "three";
import { ANIMAL_COLORS, P } from "../world/constants.js";
import type { DecodedSnapshot } from "../net/snapshot_codec.js";

const SPECIES_COUNT = 8;
const PER_SPECIES_CAP = 1024;

interface Ent {
  animal: number;
  size: number;
  // target (latest snapshot) and render (smoothed) transforms
  tx: number; ty: number; tz: number; tyaw: number;
  rx: number; ry: number; rz: number; ryaw: number;
  seen: boolean;
  isCorpse: boolean;
  meat: number;
}

function shortestAngleLerp(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class WorldView {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private corpseMesh: THREE.InstancedMesh;
  private ents = new Map<number, Ent>();
  private dummy = new THREE.Object3D();

  constructor() {
    // One InstancedMesh per species. Capsule placeholder oriented along the
    // body's forward (-Z): a stretched capsule reads as a rough animal blob.
    for (let a = 0; a < SPECIES_COUNT; a++) {
      const geo = new THREE.CapsuleGeometry(0.22, 0.7, 4, 8);
      geo.rotateX(Math.PI / 2); // lay the capsule along -Z (forward)
      const [r, g, b] = ANIMAL_COLORS[a];
      const mat = new THREE.MeshToonMaterial({ color: new THREE.Color(r, g, b) });
      const mesh = new THREE.InstancedMesh(geo, mat, PER_SPECIES_CAP);
      mesh.frustumCulled = false; // we cull by snapshot interest; instances move every frame
      mesh.count = 0;
      mesh.castShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    // Corpses: a flat dark mound.
    const cgeo = new THREE.CapsuleGeometry(0.3, 0.5, 4, 8);
    cgeo.rotateZ(Math.PI / 2);
    this.corpseMesh = new THREE.InstancedMesh(
      cgeo,
      new THREE.MeshToonMaterial({ color: new THREE.Color(0.35, 0.2, 0.18) }),
      512,
    );
    this.corpseMesh.frustumCulled = false;
    this.corpseMesh.count = 0;
    this.group.add(this.corpseMesh);
  }

  /** Apply a god-view keyframe snapshot: update targets, prune vanished entities. */
  applySnapshot(snap: DecodedSnapshot): void {
    for (const e of this.ents.values()) e.seen = false;

    for (const [id, arr] of snap.p) {
      let e = this.ents.get(id);
      const x = arr[P.PX] as number;
      const y = arr[P.PY] as number;
      const z = arr[P.PZ] as number;
      const yaw = arr[P.YAW] as number;
      if (!e) {
        e = {
          animal: (arr[P.ANIMAL] as number) & 7,
          size: arr[P.SIZE] as number,
          tx: x, ty: y, tz: z, tyaw: yaw,
          rx: x, ry: y, rz: z, ryaw: yaw,
          seen: true, isCorpse: false, meat: 1,
        };
        this.ents.set(id, e);
      } else {
        e.animal = (arr[P.ANIMAL] as number) & 7;
        e.size = arr[P.SIZE] as number;
        e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw;
        e.seen = true;
      }
    }

    // Corpses keyed in a separate id space; prefix to avoid colliding with players.
    for (const [cid, c] of snap.c) {
      const id = 0x40000000 | cid;
      let e = this.ents.get(id);
      const [x, z, size, meat, cyaw] = c;
      if (!e) {
        e = {
          animal: -1, size, tx: x, ty: 0, tz: z, tyaw: cyaw,
          rx: x, ry: 0, rz: z, ryaw: cyaw, seen: true, isCorpse: true, meat,
        };
        this.ents.set(id, e);
      } else {
        e.size = size; e.tx = x; e.tz = z; e.tyaw = cyaw; e.meat = meat; e.seen = true;
      }
    }

    for (const [id, e] of this.ents) if (!e.seen) this.ents.delete(id);
  }

  /** Per-frame: smooth render transforms toward targets, rewrite instance matrices. */
  update(dt: number): void {
    const k = 1 - Math.exp(-12 * dt); // exponential smoothing
    const counts = new Array(SPECIES_COUNT).fill(0);
    let corpseCount = 0;

    for (const e of this.ents.values()) {
      e.rx += (e.tx - e.rx) * k;
      e.ry += (e.ty - e.ry) * k;
      e.rz += (e.tz - e.rz) * k;
      e.ryaw = shortestAngleLerp(e.ryaw, e.tyaw, k);

      this.dummy.position.set(e.rx, e.ry, e.rz);
      this.dummy.rotation.set(0, e.ryaw, 0);

      if (e.isCorpse) {
        const s = Math.max(0.3, e.size);
        this.dummy.scale.set(s, s * 0.5, s);
        this.dummy.updateMatrix();
        if (corpseCount < this.corpseMesh.count + 512) {
          this.corpseMesh.setMatrixAt(corpseCount++, this.dummy.matrix);
        }
      } else {
        const s = Math.max(0.4, e.size);
        // capsule authored ~1.1 units tall; scale to roughly the animal size
        this.dummy.scale.set(s * 0.6, s * 0.6, s);
        this.dummy.updateMatrix();
        const a = e.animal;
        const mesh = this.meshes[a];
        if (counts[a] < PER_SPECIES_CAP) {
          mesh.setMatrixAt(counts[a]++, this.dummy.matrix);
        }
      }
    }

    for (let a = 0; a < SPECIES_COUNT; a++) {
      this.meshes[a].count = counts[a];
      this.meshes[a].instanceMatrix.needsUpdate = true;
    }
    this.corpseMesh.count = corpseCount;
    this.corpseMesh.instanceMatrix.needsUpdate = true;
  }

  /** Smoothed render position of an entity, for the spectate camera to follow. */
  getRenderPos(id: number): THREE.Vector3 | null {
    const e = this.ents.get(id);
    if (!e) return null;
    return new THREE.Vector3(e.rx, e.ry, e.rz);
  }

  getRenderYaw(id: number): number {
    return this.ents.get(id)?.ryaw ?? 0;
  }

  getEntityInfo(id: number): { animal: number; size: number; isCorpse: boolean } | null {
    const e = this.ents.get(id);
    if (!e) return null;
    return { animal: e.animal, size: e.size, isCorpse: e.isCorpse };
  }

  /** Live player/animal ids (excludes corpses), for spectate target cycling. */
  liveIds(): number[] {
    const out: number[] = [];
    for (const [id, e] of this.ents) if (!e.isCorpse) out.push(id);
    out.sort((a, b) => a - b);
    return out;
  }

  count(): number {
    return this.ents.size;
  }
}
