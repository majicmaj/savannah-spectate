// Floating damage numbers: when a hit lands, pop a red "-N" that overshoots in,
// rises, and fades over ~0.85s — matching the game's Label3D damage popups.
// Pooled canvas-texture billboards (Sprites auto-face the camera). Cheap: text is
// drawn once per spawn into the pooled sprite's own canvas.

import * as THREE from "three";

const POOL = 28;
const LIFETIME = 0.85;
const RISE = 1.15;       // m risen over the lifetime
const FADE_START = 0.45; // s before it starts fading
const CW = 256, CH = 128;

interface Num { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; age: number; base: number; }

export class DamageNumbers {
  readonly group = new THREE.Group();
  private pool: Num[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = CW; canvas.height = CH;
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 10;
      this.group.add(sprite);
      this.pool.push({ sprite, canvas, tex, age: LIFETIME, base: 1 });
    }
  }

  spawn(x: number, y: number, z: number, amount: number): void {
    const dmg = Math.max(1, Math.round(amount));
    const n = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    const g = n.canvas.getContext("2d")!;
    g.clearRect(0, 0, CW, CH);
    g.font = "bold 80px ui-monospace, Menlo, monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 9; g.strokeStyle = "rgba(20,0,0,0.95)";
    g.strokeText(`-${dmg}`, CW / 2, CH / 2);
    g.fillStyle = "rgb(255,92,64)";
    g.fillText(`-${dmg}`, CW / 2, CH / 2);
    n.tex.needsUpdate = true;
    // bigger hits read a touch larger
    n.base = 2.4 + Math.min(2.0, dmg * 0.06);
    n.age = 0;
    n.sprite.position.set(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5);
    n.sprite.visible = true;
  }

  update(dt: number): void {
    for (const n of this.pool) {
      if (!n.sprite.visible) continue;
      n.age += dt;
      const f = n.age / LIFETIME;
      if (f >= 1) { n.sprite.visible = false; (n.sprite.material as THREE.SpriteMaterial).opacity = 0; continue; }
      // pop: overshoot scale in over the first 150ms (back-ease), then hold
      const pop = n.age < 0.15 ? backEase(n.age / 0.15) : 1;
      const sc = n.base * (0.4 + 0.6 * pop);
      n.sprite.scale.set(sc * (CW / CH), sc, sc); // keep 2:1 canvas aspect
      n.sprite.position.y += (RISE / LIFETIME) * dt;
      const fade = n.age < FADE_START ? 1 : 1 - (n.age - FADE_START) / (LIFETIME - FADE_START);
      (n.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, fade);
    }
  }
}

// overshoot ease (TRANS_BACK-ish): goes past 1 then settles
function backEase(t: number): number {
  const s = 1.70158;
  const u = t - 1;
  return u * u * ((s + 1) * u + s) + 1;
}
