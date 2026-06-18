// Reflective stylized water (three.js "ocean" look, river-masked). One
// camera-following grid mesh with a custom shader. Depth comes from the streamed
// heightmap (waterLevel - terrain), so water only shows over real rivers/lakes
// and blends shallow→deep color; the shoreline fades + discards over land.
//
// Surface sim, matching the reference (vertex displacement + scrolling normals +
// HDRI env reflection):
//   • macro motion: a sum of directional sine waves displaces the grid verts,
//     with the analytic macro normal carried to the fragment.
//   • micro detail: two procedural fbm layers scroll across world XZ at
//     different scales/speeds and perturb the normal (the "scrolling normal map"
//     effect — asset-free, seamless, no texture upload).
//   • reflection: reflect(view, N) samples a samplerCube env map (baked from our
//     own day/night sky → reflections track the live sky), mixed in by a Schlick
//     fresnel term. A sharp Blinn glint adds the sun's specular streak.
// No per-frame planar reflector / SSR — the env cube is the reflection source,
// so cost is one texture lookup per pixel.

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import { VOXEL_WATER_LEVEL, VOXEL_WATER_SURFACE_OFFSET, RENDER_RADIUS_M } from "../world/constants.js";

export interface WaterConfig {
  colorDeep: string; colorShallow: string; waveHeight: number; waveSpeed: number;
  reflectivity: number; // 0..1 how much sky/env shows in the reflection
}
const DEFAULT: WaterConfig = {
  colorDeep: "#10384f", colorShallow: "#2f7f9e", waveHeight: 0.22, waveSpeed: 0.6, reflectivity: 1.0,
};

const SEG = 128; // grid resolution (finer → smoother displaced waves)

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
        uReflectivity: { value: c.reflectivity },
        uColorDeep: { value: new THREE.Color(c.colorDeep) },
        uColorShallow: { value: new THREE.Color(c.colorShallow) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff2d8) },
        uCamPos: { value: new THREE.Vector3() },
        uEnvMap: { value: null as THREE.CubeTexture | THREE.Texture | null },
        uDaylight: { value: 1 },
      },
      vertexShader: `
        uniform float uTime, uWaveHeight, uWaveSpeed;
        attribute float aDepth;
        varying float vDepth; varying vec3 vWorld; varying vec3 vNormal;

        // one directional sine wave → accumulate height + its XZ slope contribution
        void wave(vec2 xz, vec2 dir, float freq, float amp, float spd, float t,
                  inout float h, inout vec2 slope){
          float a = dot(xz, dir) * freq + t * spd;
          h += sin(a) * amp;
          slope += cos(a) * amp * freq * dir;
        }

        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float t = uTime * uWaveSpeed;
          float wet = step(0.04, aDepth);
          float h = 0.0; vec2 slope = vec2(0.0);
          // three crossing waves (varied dir/scale) → non-repeating swell
          wave(wp.xz, normalize(vec2( 0.8,  0.5)), 0.20, 0.60, 1.30, t, h, slope);
          wave(wp.xz, normalize(vec2(-0.6,  0.9)), 0.34, 0.34, 0.95, t, h, slope);
          wave(wp.xz, normalize(vec2( 0.3, -1.0)), 0.55, 0.18, 1.70, t, h, slope);
          h *= uWaveHeight * wet; slope *= uWaveHeight * wet;
          wp.y += h;
          vWorld = wp.xyz; vDepth = aDepth;
          vNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColorDeep, uColorShallow, uSunDir, uSunColor, uCamPos;
        uniform float uReflectivity, uDaylight, uTime;
        uniform samplerCube uEnvMap;
        varying float vDepth; varying vec3 vWorld; varying vec3 vNormal;

        // value-noise fbm (shared shape with the sky) for scrolling ripple detail
        float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

        // bump the normal by the gradient of a scrolling fbm layer
        vec3 detailBump(vec2 xz, vec2 scroll, float scale, float strength, float t){
          vec2 p = xz * scale + scroll * t;
          float e = 0.35;
          float n  = fbm(p);
          float nx = fbm(p + vec2(e, 0.0));
          float nz = fbm(p + vec2(0.0, e));
          return vec3(-(nx - n) / e, 0.0, -(nz - n) / e) * strength;
        }

        void main(){
          if (vDepth < 0.04) discard;

          // macro normal + two scrolling detail layers (the "normal map scroll")
          vec3 N = normalize(vNormal);
          N += detailBump(vWorld.xz, vec2( 0.05,  0.03), 0.30, 0.9, uTime);
          N += detailBump(vWorld.xz, vec2(-0.04,  0.06), 0.95, 0.4, uTime);
          N = normalize(N);

          vec3 V = normalize(uCamPos - vWorld);
          // Schlick fresnel (water F0 ≈ 0.02): grazing angles reflect, top-down sees depth
          float ct = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - ct, 5.0);

          // depth color: shallow → deep
          float depthT = clamp(vDepth / 4.0, 0.0, 1.0);
          vec3 base = mix(uColorShallow, uColorDeep, depthT);

          // env reflection from the live sky cube
          vec3 R = reflect(-V, N);
          vec3 refl = textureCube(uEnvMap, R).rgb;

          vec3 col = mix(base, refl, clamp(fres * uReflectivity, 0.0, 1.0));

          // sun glint (sharp Blinn specular streak, fades at night)
          vec3 Hh = normalize(uSunDir + V);
          float spec = pow(max(dot(N, Hh), 0.0), 280.0);
          col += uSunColor * spec * uDaylight;

          // alpha: more opaque at grazing angles; soften just the thin shore band
          // (rivers are often <0.5m deep, so the fade must stay near the waterline)
          float edge = smoothstep(0.04, 0.14, vDepth);
          float alpha = mix(0.70, 0.97, fres) * edge;
          gl_FragColor = vec4(col, alpha);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = VOXEL_WATER_LEVEL + VOXEL_WATER_SURFACE_OFFSET;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setHeightmap(hm: Heightmap): void { this.hm = hm; }

  /** Cube texture sampled for reflections (baked from the sky; see main.ts). */
  setEnvMap(tex: THREE.CubeTexture | THREE.Texture): void { this.mat.uniforms.uEnvMap.value = tex; }

  config(cfg: Partial<WaterConfig>): void {
    const u = this.mat.uniforms;
    if (cfg.colorDeep) u.uColorDeep.value.set(cfg.colorDeep);
    if (cfg.colorShallow) u.uColorShallow.value.set(cfg.colorShallow);
    if (cfg.waveHeight != null) u.uWaveHeight.value = cfg.waveHeight;
    if (cfg.waveSpeed != null) u.uWaveSpeed.value = cfg.waveSpeed;
    if (cfg.reflectivity != null) u.uReflectivity.value = cfg.reflectivity;
  }

  update(t: number, cam: THREE.Vector3, sunDir: THREE.Vector3, sunColor: [number, number, number], _skyColor: [number, number, number], daylight = 1): void {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCamPos.value.copy(cam);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.setRGB(sunColor[0], sunColor[1], sunColor[2]);
    u.uDaylight.value = daylight;

    // snap to integers so the world-locked waves don't swim as we follow the camera
    const cx = Math.round(cam.x), cz = Math.round(cam.z);
    this.mesh.position.x = cx;
    this.mesh.position.z = cz;
    if (!this.hm?.loaded) return;

    // resample per-vertex water depth for the current center
    const pos = (this.mesh.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const d = this.depthAttr.array as Float32Array;
    const len = d.length;
    for (let i = 0; i < len; i++) {
      const lx = pos[i * 3], lz = pos[i * 3 + 2];
      d[i] = VOXEL_WATER_LEVEL - this.hm.heightAt(cx + lx, cz + lz);
    }
    this.depthAttr.needsUpdate = true;
  }
}
