// Renders decoded snapshot entities with proper snapshot interpolation: each
// entity keeps a small buffer of timestamped samples and is rendered at
// now - INTERP_DELAY_MS, linearly interpolating position between the two
// bracketing snapshots and shortest-angle-interpolating yaw. This yields
// continuous, velocity-preserving motion instead of ease-toward-stepped-target
// stutter. Two render layers:
//  - far/most entities: per-species InstancedMesh capsules (~1 draw call/species)
//  - near the spectate target: real GLB models take over (animal_models.ts); those
//    ids are "suppressed" here so they don't double-render as capsules.

import * as THREE from "three";
import { ANIMAL_COLORS, P, INTERP_DELAY_MS } from "../world/constants.js";
import type { DecodedSnapshot } from "../net/snapshot_codec.js";
import type { Heightmap } from "../world/heightmap.js";

const SPECIES_COUNT = 8;
const PER_SPECIES_CAP = 1024;
const MAX_SAMPLES = 8;

export interface RenderEnt {
  id: number;
  animal: number;
  size: number;
  x: number; y: number; z: number; yaw: number; // interpolated render transform
  speed: number;
  aiState: number;
  sleeping: boolean;
  flightMode: number;
  isFemale: boolean;
  isCorpse: boolean;
  meat: number;
}

interface Sample { t: number; x: number; y: number; z: number; yaw: number; }

interface Ent extends RenderEnt {
  buf: Sample[];
  hp: number;
  seen: boolean;
}

export interface HitEvent { x: number; y: number; z: number; amount: number; id: number; }

const MAX_EXTRAP_MS = 170; // cap forward-prediction on packet gaps

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
  private suppressed = new Set<number>();
  private hm: Heightmap | null = null;
  private hits: HitEvent[] = [];

  setHeightmap(hm: Heightmap): void {
    this.hm = hm;
  }

  /** Hits detected since last call (HP drops), for the juice system. */
  consumeHits(): HitEvent[] {
    if (this.hits.length === 0) return [];
    const h = this.hits;
    this.hits = [];
    return h;
  }

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
    for (const e of this.ents.values()) e.seen = false;

    for (const [id, arr] of snap.p) {
      const x = arr[P.PX] as number, y = arr[P.PY] as number, z = arr[P.PZ] as number, yaw = arr[P.YAW] as number;
      this.pushSample(id, nowMs, x, y, z, yaw, (arr[P.ANIMAL] as number) & 7, arr[P.SIZE] as number, {
        aiState: arr[P.AI_STATE] as number,
        sleeping: !!arr[P.SLEEPING],
        flightMode: arr[P.FLIGHT_MODE] as number,
        isFemale: !!arr[P.IS_FEMALE],
        isCorpse: false,
        meat: 1,
        hp: arr[P.HP] as number,
      });
    }
    for (const [cid, c] of snap.c) {
      const id = 0x40000000 | cid;
      const [x, z, size, meat, cyaw] = c;
      const cy = this.hm?.loaded ? this.hm.surfaceAt(x, z) : 0; // ground the corpse
      this.pushSample(id, nowMs, x, cy, z, cyaw, -1, size, {
        aiState: 0, sleeping: false, flightMode: 0, isFemale: false, isCorpse: true, meat, hp: 0,
      });
    }

    for (const [id, e] of this.ents) if (!e.seen) this.ents.delete(id);
  }

  private pushSample(
    id: number, t: number, x: number, y: number, z: number, yaw: number,
    animal: number, size: number,
    meta: { aiState: number; sleeping: boolean; flightMode: number; isFemale: boolean; isCorpse: boolean; meat: number; hp: number },
  ): void {
    let e = this.ents.get(id);
    if (!e) {
      e = {
        id, animal, size, x, y, z, yaw, speed: 0,
        aiState: meta.aiState, sleeping: meta.sleeping, flightMode: meta.flightMode,
        isFemale: meta.isFemale, isCorpse: meta.isCorpse, meat: meta.meat,
        hp: meta.hp, buf: [{ t, x, y, z, yaw }], seen: true,
      };
      this.ents.set(id, e);
      return;
    }
    // hit detection: HP dropped (not a respawn/heal) → juice at the entity
    if (!meta.isCorpse && meta.hp < e.hp - 0.5 && meta.hp > 0) {
      this.hits.push({ x, y: y + size * 0.6, z, amount: e.hp - meta.hp, id });
    }
    e.hp = meta.hp;
    e.animal = animal; e.size = size;
    e.aiState = meta.aiState; e.sleeping = meta.sleeping; e.flightMode = meta.flightMode;
    e.isFemale = meta.isFemale; e.isCorpse = meta.isCorpse; e.meat = meta.meat;
    e.seen = true;
    const prev = e.buf[e.buf.length - 1];
    const dt = Math.max(0.001, (t - prev.t) / 1000);
    const dx = x - prev.x, dz = z - prev.z;
    e.speed = Math.sqrt(dx * dx + dz * dz) / dt;
    e.buf.push({ t, x, y, z, yaw });
    if (e.buf.length > MAX_SAMPLES) e.buf.shift();
  }

  /** Interpolate every entity's render transform to renderTime = now - delay. */
  update(now: number, center?: THREE.Vector3, radius?: number): void {
    const renderT = now - INTERP_DELAY_MS;
    const counts = new Array(SPECIES_COUNT).fill(0);
    let corpseCount = 0;
    const r2 = radius ? radius * radius : Infinity;

    for (const e of this.ents.values()) {
      this.sample(e, renderT);

      if (this.suppressed.has(e.id)) continue;
      if (center) {
        const dx = e.x - center.x, dz = e.z - center.z;
        if (dx * dx + dz * dz > r2) continue;
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

  // Write e.{x,y,z,yaw} from the sample buffer at absolute time `t`.
  private sample(e: Ent, t: number): void {
    const b = e.buf;
    if (b.length === 1) {
      e.x = b[0].x; e.y = b[0].y; e.z = b[0].z; e.yaw = b[0].yaw;
      return;
    }
    if (t <= b[0].t) {
      e.x = b[0].x; e.y = b[0].y; e.z = b[0].z; e.yaw = b[0].yaw;
      return;
    }
    const last = b[b.length - 1];
    if (t >= last.t) {
      // starved (no newer sample yet) — extrapolate the last velocity briefly
      // (capped) so a late packet glides instead of freezing then snapping.
      const prev = b[b.length - 2];
      const span = Math.max(1, last.t - prev.t);
      const f = Math.min(t - last.t, MAX_EXTRAP_MS) / span;
      e.x = last.x + (last.x - prev.x) * f;
      e.y = last.y + (last.y - prev.y) * f;
      e.z = last.z + (last.z - prev.z) * f;
      e.yaw = shortestAngleLerp(prev.yaw, last.yaw, 1 + f);
      return;
    }
    // find bracketing pair
    for (let i = b.length - 1; i > 0; i--) {
      if (t >= b[i - 1].t) {
        const a = b[i - 1], c = b[i];
        const f = (t - a.t) / Math.max(1, c.t - a.t);
        e.x = a.x + (c.x - a.x) * f;
        e.y = a.y + (c.y - a.y) * f;
        e.z = a.z + (c.z - a.z) * f;
        e.yaw = shortestAngleLerp(a.yaw, c.yaw, f);
        return;
      }
    }
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
  entities(): RenderEnt[] {
    return [...this.ents.values()];
  }
  count(): number {
    return this.ents.size;
  }
}
