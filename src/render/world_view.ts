// Renders decoded snapshot entities. Two layers:
//  - far/most entities: per-species InstancedMesh capsules (~1 draw call/species)
//  - near the spectate target: real GLB models take over (see animal_models.ts);
//    those ids are "suppressed" here so they don't double-render as capsules.
// Coord map: Godot & Three are right-handed Y-up, -Z forward → (px,py,pz)->(x,y,z),
// yaw->rotation.y directly.

import * as THREE from "three";
import { ANIMAL_COLORS, P } from "../world/constants.js";
import type { DecodedSnapshot } from "../net/snapshot_codec.js";

const SPECIES_COUNT = 8;
const PER_SPECIES_CAP = 1024;

export interface RenderEnt {
  id: number;
  animal: number;
  size: number;
  x: number; y: number; z: number; yaw: number;
  speed: number;
  aiState: number;
  sleeping: boolean;
  flightMode: number;
  isFemale: boolean;
  isCorpse: boolean;
  meat: number;
}

interface Ent extends RenderEnt {
  tx: number; ty: number; tz: number; tyaw: number;
  seen: boolean;
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
  private suppressed = new Set<number>(); // ids rendered by real GLB models instead
  private lastSnapAt = 0;

  constructor() {
    for (let a = 0; a < SPECIES_COUNT; a++) {
      const geo = new THREE.CapsuleGeometry(0.22, 0.7, 4, 8);
      geo.rotateX(Math.PI / 2);
      const [r, g, b] = ANIMAL_COLORS[a];
      const mat = new THREE.MeshToonMaterial({ color: new THREE.Color(r, g, b) });
      const mesh = new THREE.InstancedMesh(geo, mat, PER_SPECIES_CAP);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
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

  setSuppressed(ids: Set<number>): void {
    this.suppressed = ids;
  }

  applySnapshot(snap: DecodedSnapshot, nowMs: number): void {
    const dt = this.lastSnapAt ? Math.max(0.001, (nowMs - this.lastSnapAt) / 1000) : 0.05;
    this.lastSnapAt = nowMs;

    for (const e of this.ents.values()) e.seen = false;

    for (const [id, arr] of snap.p) {
      const x = arr[P.PX] as number;
      const y = arr[P.PY] as number;
      const z = arr[P.PZ] as number;
      const yaw = arr[P.YAW] as number;
      let e = this.ents.get(id);
      if (!e) {
        e = {
          id, animal: (arr[P.ANIMAL] as number) & 7, size: arr[P.SIZE] as number,
          x, y, z, yaw, speed: 0,
          aiState: arr[P.AI_STATE] as number, sleeping: !!arr[P.SLEEPING],
          flightMode: arr[P.FLIGHT_MODE] as number, isFemale: !!arr[P.IS_FEMALE],
          isCorpse: false, meat: 1,
          tx: x, ty: y, tz: z, tyaw: yaw, seen: true,
        };
        this.ents.set(id, e);
      } else {
        const dx = x - e.tx, dz = z - e.tz;
        e.speed = Math.sqrt(dx * dx + dz * dz) / dt;
        e.animal = (arr[P.ANIMAL] as number) & 7;
        e.size = arr[P.SIZE] as number;
        e.aiState = arr[P.AI_STATE] as number;
        e.sleeping = !!arr[P.SLEEPING];
        e.flightMode = arr[P.FLIGHT_MODE] as number;
        e.isFemale = !!arr[P.IS_FEMALE];
        e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw; e.seen = true;
      }
    }

    for (const [cid, c] of snap.c) {
      const id = 0x40000000 | cid;
      const [x, z, size, meat, cyaw] = c;
      let e = this.ents.get(id);
      if (!e) {
        e = {
          id, animal: -1, size, x, y: 0, z, yaw: cyaw, speed: 0,
          aiState: 0, sleeping: false, flightMode: 0, isFemale: false,
          isCorpse: true, meat,
          tx: x, ty: 0, tz: z, tyaw: cyaw, seen: true,
        };
        this.ents.set(id, e);
      } else {
        e.size = size; e.tx = x; e.tz = z; e.tyaw = cyaw; e.meat = meat; e.seen = true;
      }
    }

    for (const [id, e] of this.ents) if (!e.seen) this.ents.delete(id);
  }

  update(dt: number, center?: THREE.Vector3, radius?: number): void {
    const k = 1 - Math.exp(-12 * dt);
    const counts = new Array(SPECIES_COUNT).fill(0);
    let corpseCount = 0;
    const r2 = radius ? radius * radius : Infinity;

    for (const e of this.ents.values()) {
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.z += (e.tz - e.z) * k;
      e.yaw = shortestAngleLerp(e.yaw, e.tyaw, k);

      if (this.suppressed.has(e.id)) continue; // a real GLB model is drawing this one
      if (center) {
        const dx = e.x - center.x, dz = e.z - center.z;
        if (dx * dx + dz * dz > r2) continue; // render-distance cull
      }

      this.dummy.position.set(e.x, e.y, e.z);
      this.dummy.rotation.set(0, e.yaw, 0);

      if (e.isCorpse) {
        const s = Math.max(0.3, e.size);
        this.dummy.scale.set(s, s * 0.5, s);
        this.dummy.updateMatrix();
        if (corpseCount < 512) this.corpseMesh.setMatrixAt(corpseCount++, this.dummy.matrix);
      } else {
        const s = Math.max(0.4, e.size);
        this.dummy.scale.set(s * 0.6, s * 0.6, s);
        this.dummy.updateMatrix();
        const a = e.animal;
        if (counts[a] < PER_SPECIES_CAP) this.meshes[a].setMatrixAt(counts[a]++, this.dummy.matrix);
      }
    }

    for (let a = 0; a < SPECIES_COUNT; a++) {
      this.meshes[a].count = counts[a];
      this.meshes[a].instanceMatrix.needsUpdate = true;
    }
    this.corpseMesh.count = corpseCount;
    this.corpseMesh.instanceMatrix.needsUpdate = true;
  }

  getRenderPos(id: number): THREE.Vector3 | null {
    const e = this.ents.get(id);
    return e ? new THREE.Vector3(e.x, e.y, e.z) : null;
  }
  getRenderYaw(id: number): number {
    return this.ents.get(id)?.yaw ?? 0;
  }
  getEntityInfo(id: number): { animal: number; size: number; isCorpse: boolean } | null {
    const e = this.ents.get(id);
    return e ? { animal: e.animal, size: e.size, isCorpse: e.isCorpse } : null;
  }
  liveIds(): number[] {
    const out: number[] = [];
    for (const [id, e] of this.ents) if (!e.isCorpse) out.push(id);
    out.sort((a, b) => a - b);
    return out;
  }
  /** Snapshot of all current render entities (for the model LOD picker). */
  entities(): RenderEnt[] {
    return [...this.ents.values()];
  }
  count(): number {
    return this.ents.size;
  }
}
