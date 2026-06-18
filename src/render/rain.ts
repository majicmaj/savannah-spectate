// Cheap GPU rain: one InstancedMesh of thin billboard streaks that follows the
// camera. The fall + wrap + wind-slant is computed entirely in the vertex shader
// from uTime, so the CPU only updates a few uniforms per frame (no per-drop JS).
// Intensity (0..1, from the weather `rain` field) scales both the visible drop
// count and opacity, so a light drizzle reads differently from a downpour.
// Mirrors the game's rain look: translucent blue vertical streaks, slanted downwind.

import * as THREE from "three";

const MAX_DROPS = 2400;
const BOX_XZ = 38; // half-extent of the spawn box around the camera (m)
const BOX_H = 20; // vertical span the drops cycle through (m)

export class Rain {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;
  private intensity = 0;

  constructor() {
    // a single thin vertical quad; billboarded to the camera in the vertex shader
    const geo = new THREE.InstancedBufferGeometry();
    const w = 0.03, h = 1.0;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(
      [-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0], 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    // per-drop randoms: base XZ in the box, a phase offset, a speed jitter, a length
    const off = new Float32Array(MAX_DROPS * 3);
    const spd = new Float32Array(MAX_DROPS);
    for (let i = 0; i < MAX_DROPS; i++) {
      // cheap deterministic scatter (no Math.random — keep it reproducible)
      off[i * 3] = (frac(Math.sin(i * 12.9898) * 43758.5453) - 0.5) * 2 * BOX_XZ;
      off[i * 3 + 1] = frac(Math.sin(i * 78.233) * 43758.5453) * BOX_H; // phase along the fall
      off[i * 3 + 2] = (frac(Math.sin(i * 39.346) * 43758.5453) - 0.5) * 2 * BOX_XZ;
      spd[i] = 0.8 + frac(Math.sin(i * 11.17) * 43758.5453) * 0.5;
    }
    geo.setAttribute("iOffset", new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute("iSpeed", new THREE.InstancedBufferAttribute(spd, 1));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uFall: { value: 26.0 },   // m/s fall speed
        uBoxH: { value: BOX_H },
        uWind: { value: new THREE.Vector2(0.15, 0.05) }, // screen-space slant + world drift
        uOpacity: { value: 0.0 },
        uColor: { value: new THREE.Color(0.52, 0.68, 0.96) },
        uLen: { value: 1.05 },    // streak length (m)
      },
      vertexShader: `
        uniform float uTime, uFall, uBoxH, uLen;
        uniform vec2 uWind;
        attribute vec3 iOffset;
        attribute float iSpeed;
        void main(){
          // fall: cycle the drop's height through [0, uBoxH], scrolling down over time
          float y = mod(iOffset.y - uTime * uFall * iSpeed, uBoxH);
          float fallen = uBoxH - y;                       // distance from the top
          // instance center, relative to the camera-following group; wind drifts it downwind
          vec3 ip = vec3(iOffset.x + uWind.y * fallen, y, iOffset.z + uWind.y * fallen);
          vec4 mv = modelViewMatrix * vec4(ip, 1.0);      // center in view space → billboard
          // local quad extent in view space: x = width, y = streak length (slanted by wind)
          mv.x += position.x + position.y * uLen * uWind.x;
          mv.y += position.y * uLen;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main(){
          gl_FragColor = vec4(uColor, uOpacity);
        }`,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX_DROPS);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2; // after water/terrain, before HUD
  }

  /** intensity 0..1 (weather rain). Below ~0.02 the system is fully hidden. */
  setIntensity(v: number): void { this.intensity = Math.min(1, Math.max(0, v)); }

  update(t: number, cam: THREE.Vector3, windX: number, windZ: number, enabled: boolean): void {
    const on = enabled && this.intensity > 0.02;
    this.mesh.visible = on;
    if (!on) { this.mesh.count = 0; return; }
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uOpacity.value = 0.5 * this.intensity;
    u.uWind.value.set(0.12 + windX * 0.08, 0.06 + windZ * 0.04);
    // ramp drop count with intensity so drizzle is sparse
    this.mesh.count = Math.ceil(MAX_DROPS * (0.25 + 0.75 * this.intensity));
    // follow the camera (box centered horizontally; a bit below so rain spans up + down)
    this.mesh.position.set(cam.x, cam.y - 5, cam.z);
  }
}

function frac(v: number): number { return v - Math.floor(v); }
