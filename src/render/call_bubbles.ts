// Overhead call bubbles: when an animal vocalizes (a call event from the snapshot),
// pop a little speech bubble above it with the call text ("Hi!", "Danger!", ...),
// colored per call type — mirrors the game's call bubbles. Pooled canvas-texture
// billboards that rise slightly and fade over ~1.6s.

import * as THREE from "three";

// indexed by call_type (SavConst CALL_*): 0 Friendly,1 Danger,2 Challenge,
// 3 Come(indiv),4 Mate,5 Rally(group),6 Attack-target
const CALL_TEXT = ["Hi!", "Danger!", "Grrr!", "Come!", "♥", "Rally!", "🎯"];
const CALL_COLOR = [
  "rgb(140,255,140)", "rgb(255,90,90)", "rgb(255,191,64)", "rgb(128,204,255)",
  "rgb(255,140,216)", "rgb(77,166,255)", "rgb(255,102,51)",
];

const POOL = 24;
const LIFETIME = 1.6;
const RISE = 0.8;
const FADE_START = 1.0;
const CW = 256, CH = 128;

interface Bubble { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; age: number; }

export class CallBubbles {
  readonly group = new THREE.Group();
  private pool: Bubble[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = CW; canvas.height = CH;
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 11;
      this.group.add(sprite);
      this.pool.push({ sprite, canvas, tex, age: LIFETIME });
    }
  }

  spawn(x: number, y: number, z: number, callType: number): void {
    const text = CALL_TEXT[callType] ?? "?";
    const color = CALL_COLOR[callType] ?? "rgb(230,230,230)";
    const b = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    const g = b.canvas.getContext("2d")!;
    g.clearRect(0, 0, CW, CH);
    // text only (no bubble) — colored fill + dark outline for legibility over the scene
    g.font = "bold 64px ui-monospace, Menlo, monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 8; g.strokeStyle = "rgba(10,12,14,0.9)";
    g.strokeText(text, CW / 2, CH / 2);
    g.fillStyle = color;
    g.fillText(text, CW / 2, CH / 2);
    b.tex.needsUpdate = true;
    b.age = 0;
    b.sprite.position.set(x, y + 0.4, z);
    b.sprite.scale.set(3.0 * (CW / CH), 3.0, 3.0);
    b.sprite.visible = true;
  }

  update(dt: number): void {
    for (const b of this.pool) {
      if (!b.sprite.visible) continue;
      b.age += dt;
      const f = b.age / LIFETIME;
      if (f >= 1) { b.sprite.visible = false; (b.sprite.material as THREE.SpriteMaterial).opacity = 0; continue; }
      const pop = b.age < 0.12 ? b.age / 0.12 : 1;
      b.sprite.scale.set(3.0 * (CW / CH) * pop, 3.0 * pop, 1);
      b.sprite.position.y += (RISE / LIFETIME) * dt;
      const fade = b.age < FADE_START ? 1 : 1 - (b.age - FADE_START) / (LIFETIME - FADE_START);
      (b.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, fade);
    }
  }
}
