// Performant stylized water: one camera-following grid mesh with a custom shader.
// Depth comes from the streamed heightmap (waterLevel - terrain), so water only
// shows over real rivers/lakes and blends shallow→deep color; fresnel adds a sky
// reflection and the sun a specular glint. No render targets / reflections — just
// vertex sine-waves + analytic normals. Cheap and good-looking.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import { VOXEL_WATER_LEVEL, VOXEL_WATER_SURFACE_OFFSET, RENDER_RADIUS_M } from "../world/constants.js";

export interface WaterConfig {
  colorDeep: string; colorShallow: string; waveHeight: number; waveSpeed: number; roughness: number;
}
const DEFAULT: WaterConfig = {
  colorDeep: "#10384f", colorShallow: "#2f7f9e", waveHeight: 0.14, waveSpeed: 0.6, roughness: 0.2,
};

const SEG = 96; // grid resolution

export class Water {
  readonly mesh: THREE.Mesh;
  private hm: Heightmap | null = null;
  private depthAttr: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  private size = RENDER_RADIUS_M * 2.2;

  constructor(cfg: Partial<WaterConfig> = {}) {
    const c = { ...DEFAULT, ...cfg };
    const geo = new THREE.PlaneGeometry(this.size, this.size, SEG, SEG);
    geo.rotateX(-Math.PI / 2); // lie flat in XZ, local y = world y
    const n = geo.attributes.position.count;
    this.depthAttr = new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1);
    this.depthAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aDepth", this.depthAttr);

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uWaveHeight: { value: c.waveHeight },
        uWaveSpeed: { value: c.waveSpeed },
        uRoughness: { value: c.roughness },
        uColorDeep: { value: new THREE.Color(c.colorDeep) },
        uColorShallow: { value: new THREE.Color(c.colorShallow) },
        uSkyColor: { value: new THREE.Color(0x9fc0d8) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff2d8) },
        uCamPos: { value: new THREE.Vector3() },
      },
      vertexShader: `
        uniform float uTime, uWaveHeight, uWaveSpeed;
        attribute float aDepth;
        varying float vDepth; varying vec3 vWorld; varying vec3 vNormal;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float t = uTime * uWaveSpeed;
          // two crossing waves on world XZ; analytic normal from derivatives
          float a1 = dot(wp.xz, vec2(0.18, 0.11)) + t * 1.3;
          float a2 = dot(wp.xz, vec2(-0.09, 0.21)) + t * 0.9;
          float wet = step(0.04, aDepth);
          float h = (sin(a1) * 0.6 + sin(a2) * 0.4) * uWaveHeight * wet;
          float dhx = (cos(a1) * 0.18 * 0.6 + cos(a2) * -0.09 * 0.4) * uWaveHeight * wet;
          float dhz = (cos(a1) * 0.11 * 0.6 + cos(a2) * 0.21 * 0.4) * uWaveHeight * wet;
          wp.y += h;
          vWorld = wp.xyz; vDepth = aDepth;
          vNormal = normalize(vec3(-dhx, 1.0, -dhz));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColorDeep, uColorShallow, uSkyColor, uSunDir, uSunColor, uCamPos;
        uniform float uRoughness;
        varying float vDepth; varying vec3 vWorld; varying vec3 vNormal;
        void main(){
          if (vDepth < 0.04) discard;
          vec3 N = normalize(vNormal);
          vec3 V = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          float depthT = clamp(vDepth / 4.0, 0.0, 1.0);
          vec3 base = mix(uColorShallow, uColorDeep, depthT);
          vec3 col = mix(base, uSkyColor, fres * (1.0 - uRoughness) * 0.65);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), mix(20.0, 220.0, 1.0 - uRoughness));
          col += uSunColor * spec * (1.0 - uRoughness);
          float alpha = mix(0.74, 0.96, fres);
          gl_FragColor = vec4(col, alpha);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = VOXEL_WATER_LEVEL + VOXEL_WATER_SURFACE_OFFSET;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setHeightmap(hm: Heightmap): void { this.hm = hm; }

  config(cfg: Partial<WaterConfig>): void {
    const u = this.mat.uniforms;
    if (cfg.colorDeep) u.uColorDeep.value.set(cfg.colorDeep);
    if (cfg.colorShallow) u.uColorShallow.value.set(cfg.colorShallow);
    if (cfg.waveHeight != null) u.uWaveHeight.value = cfg.waveHeight;
    if (cfg.waveSpeed != null) u.uWaveSpeed.value = cfg.waveSpeed;
    if (cfg.roughness != null) u.uRoughness.value = cfg.roughness;
  }

  update(t: number, cam: THREE.Vector3, sunDir: THREE.Vector3, sunColor: [number, number, number], skyColor: [number, number, number]): void {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCamPos.value.copy(cam);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.setRGB(sunColor[0], sunColor[1], sunColor[2]);
    u.uSkyColor.value.setRGB(skyColor[0], skyColor[1], skyColor[2]);

    // snap to integers so the world-locked waves don't swim as we follow the camera
    const cx = Math.round(cam.x), cz = Math.round(cam.z);
    this.mesh.position.x = cx;
    this.mesh.position.z = cz;
    if (!this.hm?.loaded) return;

    // resample per-vertex water depth for the current center
    const pos = (this.mesh.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const d = this.depthAttr.array as Float32Array;
    const n = d.length;
    for (let i = 0; i < n; i++) {
      const lx = pos[i * 3], lz = pos[i * 3 + 2];
      d[i] = VOXEL_WATER_LEVEL - this.hm.heightAt(cx + lx, cz + lz);
    }
    this.depthAttr.needsUpdate = true;
  }
}
