// Spectate camera: third-person chase that sits behind the followed entity along
// its heading and looks at it. Controls (wired in main.ts):
//   R        pick a random live target
//   [ / ]    previous / next target (stable id order)
//   wheel    zoom in / out
// The camera follows the entity's facing yaw, so it reads like an over-the-
// shoulder chase that swings around as the animal turns.

import * as THREE from "three";
import type { WorldView } from "./world_view.js";

const MIN_DIST = 3;
const MAX_DIST = 60;

export class SpectateCamera {
  targetId: number | null = null;
  private distance = 12;
  private height = 4;
  private camPos = new THREE.Vector3(0, 20, 30);
  private lookAt = new THREE.Vector3();
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  zoom(deltaY: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance + deltaY * 0.02, MIN_DIST, MAX_DIST);
    this.height = this.distance * 0.35;
  }

  random(view: WorldView): void {
    const ids = view.liveIds();
    if (ids.length === 0) return;
    // index varies without Math.random by mixing the current target into a step.
    const seed = (this.targetId ?? 0) * 2654435761;
    const idx = Math.abs(seed ^ ids.length) % ids.length;
    this.targetId = ids[idx];
  }

  step(view: WorldView, dir: number): void {
    const ids = view.liveIds();
    if (ids.length === 0) return;
    if (this.targetId == null) {
      this.targetId = ids[0];
      return;
    }
    let i = ids.indexOf(this.targetId);
    if (i < 0) i = 0;
    i = (i + dir + ids.length) % ids.length;
    this.targetId = ids[i];
  }

  /** Ensure we have a target if any exist (called when the first snapshot lands). */
  ensureTarget(view: WorldView): void {
    if (this.targetId != null && view.getRenderPos(this.targetId)) return;
    const ids = view.liveIds();
    if (ids.length) this.targetId = ids[0];
  }

  update(dt: number, view: WorldView): void {
    if (this.targetId == null) this.ensureTarget(view);
    let pos = this.targetId != null ? view.getRenderPos(this.targetId) : null;
    if (!pos) {
      // target vanished — fall back to any live entity
      this.ensureTarget(view);
      pos = this.targetId != null ? view.getRenderPos(this.targetId) : null;
      if (!pos) return;
    }
    const yaw = view.getRenderYaw(this.targetId!);
    // forward (-Z rotated by yaw); camera sits behind = +forward-reversed.
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const desired = new THREE.Vector3(
      pos.x - fwdX * this.distance,
      pos.y + this.height,
      pos.z - fwdZ * this.distance,
    );

    const follow = this.initialized ? 1 - Math.exp(-6 * dt) : 1;
    this.initialized = true;
    this.camPos.lerp(desired, follow);
    this.lookAt.lerp(new THREE.Vector3(pos.x, pos.y + 1, pos.z), follow);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookAt);
  }
}
