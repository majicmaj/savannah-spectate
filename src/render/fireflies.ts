// Fireflies: a cheap GPU points cloud of warm blinking motes that appears at
// night, scattered on land around the camera. Each point blinks on its own phase
// (computed in the shader from uTime), fades in with nightfall (uNight), and is
// additively blended for a glow. Positions rebuild only when the camera moves to
// a new cell (like the grass carpet). Texture: sfx/firefly_1.png.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import { VOXEL_WATER_LEVEL } from "../world/constants.js";

const CAP = 420;
const RADIUS = 110;   // scatter radius around the camera (m)
const SPACING = 11;   // cell size for the deterministic scatter (m)

function hash(x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Fireflies {
  readonly points: THREE.Points;
  private hm: Heightmap | null = null;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private phase: Float32Array;
  private mat: THREE.ShaderMaterial;
  private lastCellX = NaN;
  private lastCellZ = NaN;
  private n = 0;
  private night = 0;

  constructor() {
    const tex = new THREE.TextureLoader().load("/textures/sfx/firefly_1.png");
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;

    this.pos = new Float32Array(CAP * 3);
    this.phase = new Float32Array(CAP);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aPhase", new THREE.BufferAttribute(this.phase, 1));
    this.geo.setDrawRange(0, 0);

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uNight: { value: 0 },
        uTex: { value: tex },
        uColor: { value: new THREE.Color(1.0, 0.98, 0.78) },
        uSize: { value: 90.0 },
      },
      vertexShader: `
        uniform float uTime, uSize;
        attribute float aPhase;
        varying float vBlink;
        void main(){
          // sharp on/off blink (off at rest, like real fireflies)
          float s = sin(uTime * (1.3 + 0.5 * fract(aPhase)) + aPhase * 6.2831);
          vBlink = pow(max(0.0, s), 3.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (1.0 / max(1.0, -mv.z)) * (0.6 + vBlink);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        uniform vec3 uColor;
        uniform float uNight;
        varying float vBlink;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * vBlink * uNight;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * t.rgb, a);
        }`,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  setHeightmap(hm: Heightmap): void { this.hm = hm; }

  /** night = 0(day)..1(full night); positions rebuild as the camera moves. */
  update(t: number, cam: THREE.Vector3, night: number): void {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uNight.value = night;
    this.night = night;
    this.points.visible = night > 0.02;
    if (!this.points.visible || !this.hm?.loaded) return;

    const cx = Math.round(cam.x / SPACING), cz = Math.round(cam.z / SPACING);
    if (cx === this.lastCellX && cz === this.lastCellZ) return;
    this.lastCellX = cx; this.lastCellZ = cz;

    const cells = Math.floor(RADIUS / SPACING), r2 = RADIUS * RADIUS;
    let n = 0;
    for (let dz = -cells; dz <= cells && n < CAP; dz++) {
      for (let dx = -cells; dx <= cells && n < CAP; dx++) {
        const gx = (cx + dx) * SPACING, gz = (cz + dz) * SPACING;
        const ddx = gx - cam.x, ddz = gz - cam.z;
        if (ddx * ddx + ddz * ddz > r2) continue;
        if (hash(gx | 0, gz | 0) > 0.5) continue; // ~half the cells host a mote
        const wx = gx + (hash((gx | 0) + 5, gz | 0) - 0.5) * SPACING;
        const wz = gz + (hash(gx | 0, (gz | 0) + 7) - 0.5) * SPACING;
        if (this.hm.heightAt(wx, wz) < VOXEL_WATER_LEVEL) continue; // not over water
        const y = this.hm.surfaceAt(wx, wz) + 0.6 + hash((gx | 0) + 3, (gz | 0) + 9) * 1.6;
        this.pos[n * 3] = wx; this.pos[n * 3 + 1] = y; this.pos[n * 3 + 2] = wz;
        this.phase[n] = hash((gx | 0) + 11, (gz | 0) + 13);
        n++;
      }
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aPhase as THREE.BufferAttribute).needsUpdate = true;
  }

  count(): number { return this.points.visible ? this.n : 0; }
}
