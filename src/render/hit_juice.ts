// Hit juice: when an entity's HP drops (detected in WorldView), pop an additive
// burst sprite at the hit point that scales up and fades over ~0.35s. Pooled,
// billboarded. Self-contained — no combat events needed, just the HP delta.

import * as THREE from "three";

function burstTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, "rgba(255,255,240,1)");
  grad.addColorStop(0.3, "rgba(255,210,90,0.95)");
  grad.addColorStop(0.65, "rgba(255,120,40,0.5)");
  grad.addColorStop(1.0, "rgba(255,80,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Spark { sprite: THREE.Sprite; age: number; life: number; size: number; }

export class HitJuice {
  readonly group = new THREE.Group();
  private pool: Spark[] = [];
  private tex = burstTexture();

  spawn(x: number, y: number, z: number, amount: number): void {
    const s = this.acquire();
    s.sprite.position.set(x, y, z);
    s.age = 0;
    s.life = 0.35;
    s.size = 1.4 + Math.min(3.5, amount * 0.18);
    s.sprite.visible = true;
  }

  private acquire(): Spark {
    for (const s of this.pool) if (!s.sprite.visible) return s;
    const mat = new THREE.SpriteMaterial({ map: this.tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    this.group.add(sprite);
    const sp: Spark = { sprite, age: 0, life: 0.35, size: 1 };
    this.pool.push(sp);
    return sp;
  }

  update(dt: number): void {
    for (const s of this.pool) {
      if (!s.sprite.visible) continue;
      s.age += dt;
      const f = s.age / s.life;
      if (f >= 1) { s.sprite.visible = false; continue; }
      const sc = s.size * (0.5 + f * 2.0);
      s.sprite.scale.set(sc, sc, sc);
      (s.sprite.material as THREE.SpriteMaterial).opacity = (1 - f) * (1 - f);
    }
  }
}
