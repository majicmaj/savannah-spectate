// Run dust: pooled billboard puffs kicked up under fast-moving animals, matching
// the game's sprint dirt (textures/sfx/dirt_0|1.png). Each puff rises, drifts
// backward from the animal's heading, expands, and fades over ~0.5s. Driven from
// main: any non-corpse entity above the run-speed threshold emits puffs at a rate
// scaled by its speed. Pooled + capped; gated by the `dust` setting.

import * as THREE from "three";

const POOL = 140;
const LIFETIME = 0.5;
const RISE = 0.35;       // m risen over the lifetime (× size)
const RUN_SPEED = 5.0;   // m/s above which an animal kicks up dust
const RATE = 9.0;        // puffs/sec at full sprint

interface Puff { sprite: THREE.Sprite; age: number; vx: number; vz: number; size: number; }

export class Dust {
  readonly group = new THREE.Group();
  private pool: Puff[] = [];
  private cursor = 0;

  constructor() {
    const tex = [0, 1].map((i) => {
      const t = new THREE.TextureLoader().load(`/textures/sfx/dirt_${i}.png`);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      return t;
    });
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex[i & 1], transparent: true, depthWrite: false,
        color: new THREE.Color(0.78, 0.66, 0.46), opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.pool.push({ sprite, age: LIFETIME, vx: 0, vz: 0, size: 1 });
    }
  }

  private spawn(x: number, y: number, z: number, size: number, vx: number, vz: number): void {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    p.age = 0; p.size = size; p.vx = vx; p.vz = vz;
    p.sprite.position.set(x, y, z);
    p.sprite.visible = true;
    (p.sprite.material as THREE.SpriteMaterial).opacity = 0.7;
  }

  /**
   * Emit dust for one entity this frame if it's running. heading is its yaw
   * (radians); dust drifts backward from it. accumulators are folded into the
   * probabilistic rate so we don't need per-entity state.
   */
  emit(dt: number, x: number, y: number, z: number, size: number, speed: number, heading: number): void {
    if (speed < RUN_SPEED) return;
    const speedFactor = Math.min(1.5, speed / 9.0);
    if (Math.random() > dt * RATE * speedFactor) return;
    // backward from heading + a little spread
    const bx = -Math.sin(heading), bz = -Math.cos(heading);
    const spread = (Math.random() - 0.5) * 0.6;
    const drift = 0.6 + Math.random() * 0.5;
    this.spawn(
      x + bx * size * 0.4, y + 0.1, z + bz * size * 0.4,
      size,
      (bx + spread) * drift, (bz - spread) * drift,
    );
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      const f = p.age / LIFETIME;
      if (f >= 1) { p.sprite.visible = false; (p.sprite.material as THREE.SpriteMaterial).opacity = 0; continue; }
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.position.y += RISE * p.size * dt;
      const sc = p.size * (0.5 + f * 1.1); // expand as it rises
      p.sprite.scale.set(sc, sc, sc);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.7 * (1 - f) * (1 - f);
    }
  }
}
