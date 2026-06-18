// Spectate camera: third-person chase behind the followed entity along its
// heading. Drag (mouse) or arrow keys orbit the camera around the target; on
// release the orbit offset decays smoothly back to the default chase pose.

import * as THREE from "three";
import type { WorldView } from "./world_view.js";

const MIN_DIST = 3;
const MAX_DIST = 60;
const ARROW_SPEED = 1.6; // rad/s
const DRAG_SENS = 0.006; // rad/px

export class SpectateCamera {
  targetId: number | null = null;
  private distance = 12;
  private targetDist = 12; // auto-zoom goal (eased into distance); set by target size
  private height = 4;
  private camPos = new THREE.Vector3(0, 20, 30);
  private lookAt = new THREE.Vector3();
  private initialized = false;
  private facing = false; // F5: view the animal from the front instead of behind
  private lastTarget: number | null = null;

  // orbit offset (added on top of the chase pose), decays to 0 when released
  private orbitYaw = 0;
  private orbitPitch = 0;
  dragging = false; // set by mouse handlers
  arrows = { left: false, right: false, up: false, down: false };

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  zoom(deltaY: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance + deltaY * 0.02, MIN_DIST, MAX_DIST);
    this.targetDist = this.distance; // manual zoom overrides the size-based auto-zoom
    this.height = this.distance * 0.35;
  }

  /** F5: flip the camera to face the animal head-on instead of chasing behind. */
  flip(): void { this.facing = !this.facing; }

  dragOrbit(dx: number, dy: number): void {
    this.orbitYaw += dx * DRAG_SENS;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch - dy * DRAG_SENS, -1.0, 1.1);
  }

  random(view: WorldView): void {
    const ids = view.liveIds();
    if (ids.length === 0) return;
    const seed = (this.targetId ?? 0) * 2654435761;
    this.targetId = ids[Math.abs(seed ^ ids.length) % ids.length];
  }
  step(view: WorldView, dir: number): void {
    const ids = view.liveIds();
    if (ids.length === 0) return;
    if (this.targetId == null) { this.targetId = ids[0]; return; }
    let i = ids.indexOf(this.targetId);
    if (i < 0) i = 0;
    this.targetId = ids[(i + dir + ids.length) % ids.length];
  }
  ensureTarget(view: WorldView): void {
    if (this.targetId != null && view.getRenderPos(this.targetId)) return;
    const ids = view.liveIds();
    if (ids.length) this.targetId = ids[0];
  }

  update(dt: number, view: WorldView): void {
    // arrow-key orbit
    const a = this.arrows;
    if (a.left || a.right || a.up || a.down) {
      this.orbitYaw += ((a.right ? 1 : 0) - (a.left ? 1 : 0)) * ARROW_SPEED * dt;
      this.orbitPitch = THREE.MathUtils.clamp(
        this.orbitPitch + ((a.up ? 1 : 0) - (a.down ? 1 : 0)) * ARROW_SPEED * dt, -1.0, 1.1);
    }
    const controlling = this.dragging || a.left || a.right || a.up || a.down;
    // decay orbit back to chase pose when not actively controlling
    if (!controlling) {
      const k = 1 - Math.exp(-3.5 * dt);
      this.orbitYaw += (0 - this.orbitYaw) * k;
      this.orbitPitch += (0 - this.orbitPitch) * k;
    }

    if (this.targetId == null) this.ensureTarget(view);
    let pos = this.targetId != null ? view.getRenderPos(this.targetId) : null;
    if (!pos) { this.ensureTarget(view); pos = this.targetId != null ? view.getRenderPos(this.targetId) : null; }
    if (!pos) return;
    const yaw = view.getRenderYaw(this.targetId!);

    // size-based auto-zoom: on switching target, frame the whole animal — pull
    // back for big animals, move in for small ones (eased; manual zoom overrides).
    if (this.targetId !== this.lastTarget) {
      this.lastTarget = this.targetId;
      const info = view.getEntityInfo(this.targetId!);
      const size = info ? Math.max(0.4, info.size) : 1;
      this.targetDist = THREE.MathUtils.clamp(size * 3.6 + 3.5, MIN_DIST, MAX_DIST);
    }
    this.distance += (this.targetDist - this.distance) * (1 - Math.exp(-4 * dt));
    this.height = this.distance * 0.35;

    // spherical around target: azimuth = heading + orbitYaw; elevation =
    // base(height/distance) + orbitPitch; radius = chase diagonal.
    const radius = Math.hypot(this.distance, this.height);
    // facing flip adds π to the azimuth; the camPos lerp below arcs there smoothly
    const az = yaw + this.orbitYaw + (this.facing ? Math.PI : 0);
    const pitch = THREE.MathUtils.clamp(Math.atan2(this.height, this.distance) + this.orbitPitch, 0.04, 1.45);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const desired = new THREE.Vector3(
      pos.x + radius * cp * Math.sin(az),
      pos.y + radius * sp,
      pos.z + radius * cp * Math.cos(az),
    );

    const follow = this.initialized ? 1 - Math.exp(-7 * dt) : 1;
    this.initialized = true;
    this.camPos.lerp(desired, follow);
    this.lookAt.lerp(new THREE.Vector3(pos.x, pos.y + 1, pos.z), follow);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookAt);
  }
}
