// Reflective stylized water (three.js "ocean" look, river-masked) — SUPER cheap.
// One camera-following grid mesh with a custom shader. The wet/dry mask is decided
// PER PIXEL by sampling the streamed heightmap as a NEAREST data texture, so the
// shoreline lands exactly on voxel-block edges and never shifts as the camera
// moves (the old version re-sampled depth at ~5 m grid vertices every frame, so
// the interpolated edge jittered in/out over blocks). Zero per-frame CPU work:
// the loop only sets a handful of uniforms; everything else is on the GPU.
//
// Surface: vertex sine-wave displacement + two scrolling fbm detail-normal layers,
// Schlick fresnel, a sun glint, a 50% live-sky tint, and an env-cube reflection
// (baked from our own sky in main.ts → one cube lookup per pixel).

import * as THREE from "three";
import { Heightmap } from "../world/heightmap.js";
import { VOXEL_WATER_LEVEL, VOXEL_WATER_SURFACE_OFFSET, RENDER_RADIUS_M } from "../world/constants.js";

export interface WaterConfig {
  colorDeep: string; colorShallow: string; waveHeight: number; waveSpeed: number;
  reflectivity: number; // 0..1 how much sky/env shows in the reflection
}
const DEFAULT: WaterConfig = {
  // savannah water: warm teal-green deep, pale aqua shallows (not navy)
  colorDeep: "#1c5a52", colorShallow: "#5fa39a", waveHeight: 0.22, waveSpeed: 0.6, reflectivity: 1.0,
};

const SEG = 96; // grid resolution — only matters for wave smoothness now (no CPU depth)

export class Water {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private heightTex: THREE.DataTexture;
  private size = RENDER_RADIUS_M * 2.2;

  constructor(cfg: Partial<WaterConfig> = {}) {
    const c = { ...DEFAULT, ...cfg };
    const geo = new THREE.PlaneGeometry(this.size, this.size, SEG, SEG);
    geo.rotateX(-Math.PI / 2); // lie flat in XZ, local y = world y

    // 1×1 placeholder height texture (height 255 → depth < 0 → all discarded)
    // until the real heightmap arrives via setHeightmap().
    this.heightTex = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
    this.heightTex.needsUpdate = true;

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uWaveHeight: { value: c.waveHeight },
        uWaveSpeed: { value: c.waveSpeed },
        uReflectivity: { value: c.reflectivity },
        uColorDeep: { value: new THREE.Color(c.colorDeep) },
        uColorShallow: { value: new THREE.Color(c.colorShallow) },
        uSkyColor: { value: new THREE.Color(0x9fc0d8) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff2d8) },
        uCamPos: { value: new THREE.Vector3() },
        uEnvMap: { value: null as THREE.CubeTexture | THREE.Texture | null },
        uDaylight: { value: 1 },
        // heightmap sampling
        uHeightTex: { value: this.heightTex },
        uMapSize: { value: new THREE.Vector2(1, 1) }, // W, H
        uMapHalf: { value: new THREE.Vector2(0, 0) }, // halfW, halfH
        uWaterLevel: { value: VOXEL_WATER_LEVEL },
      },
      vertexShader: `
        uniform float uTime, uWaveHeight, uWaveSpeed;
        varying vec3 vWorld; varying vec3 vNormal;

        void wave(vec2 xz, vec2 dir, float freq, float amp, float spd, float t,
                  inout float h, inout vec2 slope){
          float a = dot(xz, dir) * freq + t * spd;
          h += sin(a) * amp;
          slope += cos(a) * amp * freq * dir;
        }

        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float t = uTime * uWaveSpeed;
          float h = 0.0; vec2 slope = vec2(0.0);
          wave(wp.xz, normalize(vec2( 0.8,  0.5)), 0.20, 0.60, 1.30, t, h, slope);
          wave(wp.xz, normalize(vec2(-0.6,  0.9)), 0.34, 0.34, 0.95, t, h, slope);
          wave(wp.xz, normalize(vec2( 0.3, -1.0)), 0.55, 0.18, 1.70, t, h, slope);
          h *= uWaveHeight; slope *= uWaveHeight;
          wp.y += h;
          vWorld = wp.xyz;
          vNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColorDeep, uColorShallow, uSkyColor, uSunDir, uSunColor, uCamPos;
        uniform float uReflectivity, uDaylight, uTime, uWaterLevel;
        uniform samplerCube uEnvMap;
        uniform sampler2D uHeightTex;
        uniform vec2 uMapSize, uMapHalf;
        varying vec3 vWorld; varying vec3 vNormal;

        // voxel-column height at world XZ — NEAREST sample of the streamed heightmap.
        // uv maps world (x,z) → texel (floor(x)+halfW, floor(z)+halfH), matching
        // Heightmap.heightAt's centered/toroidal indexing.
        float terrainHeight(vec2 xz){
          vec2 uv = (xz + uMapHalf) / uMapSize;
          return texture2D(uHeightTex, uv).r * 255.0;
        }

        float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        vec3 detailBump(vec2 xz, vec2 scroll, float scale, float strength, float t){
          vec2 p = xz * scale + scroll * t;
          float e = 0.35;
          float n  = fbm(p);
          float nx = fbm(p + vec2(e, 0.0));
          float nz = fbm(p + vec2(0.0, e));
          return vec3(-(nx - n) / e, 0.0, -(nz - n) / e) * strength;
        }

        void main(){
          // per-pixel depth → exact, block-aligned, frame-stable shoreline
          float depth = uWaterLevel - terrainHeight(vWorld.xz);
          if (depth < 0.04) discard;

          vec3 N = normalize(vNormal);
          N += detailBump(vWorld.xz, vec2( 0.05,  0.03), 0.30, 0.9, uTime);
          N += detailBump(vWorld.xz, vec2(-0.04,  0.06), 0.95, 0.4, uTime);
          N = normalize(N);

          vec3 V = normalize(uCamPos - vWorld);
          float ct = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - ct, 5.0);

          // depth-driven body color: shallow water is mostly sky-tinted/clear,
          // deep water accumulates more of the savannah water color (a cheap
          // "color fog" — one mix, no extra texture work).
          float depthT = clamp(depth / 4.0, 0.0, 1.0);
          vec3 base = mix(uColorShallow, uColorDeep, depthT);
          float skyMix = mix(0.7, 0.22, depthT); // shallow → 70% sky, deep → 22%
          base = mix(base, uSkyColor, skyMix);

          vec3 R = reflect(-V, N);
          vec3 refl = textureCube(uEnvMap, R).rgb;
          vec3 col = mix(base, refl, clamp(fres * uReflectivity, 0.0, 1.0));

          vec3 Hh = normalize(uSunDir + V);
          float spec = pow(max(dot(N, Hh), 0.0), 280.0);
          col += uSunColor * spec * uDaylight;

          float edge = smoothstep(0.04, 0.14, depth);
          float alpha = mix(0.70, 0.97, fres) * edge;
          gl_FragColor = vec4(col, alpha);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = VOXEL_WATER_LEVEL + VOXEL_WATER_SURFACE_OFFSET;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  // Build the NEAREST height texture once from the streamed heightmap.
  setHeightmap(hm: Heightmap): void {
    if (!hm.loaded) return;
    // copy into a fresh ArrayBuffer-backed view (heights is a subarray of the WS
    // payload; also decouples the texture from that buffer)
    const data = new Uint8Array(hm.heights);
    const tex = new THREE.DataTexture(data, hm.W, hm.H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping; // toroidal world, matches heightAt wrapping
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    this.heightTex.dispose();
    this.heightTex = tex;
    const u = this.mat.uniforms;
    u.uHeightTex.value = tex;
    u.uMapSize.value.set(hm.W, hm.H);
    u.uMapHalf.value.set(hm.half, hm.half);
  }

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

  update(t: number, cam: THREE.Vector3, sunDir: THREE.Vector3, sunColor: [number, number, number], skyColor: [number, number, number], daylight = 1): void {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCamPos.value.copy(cam);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.setRGB(sunColor[0], sunColor[1], sunColor[2]);
    u.uSkyColor.value.setRGB(skyColor[0], skyColor[1], skyColor[2]);
    u.uDaylight.value = daylight;
    // follow the camera so the grid always covers the view. No snapping / depth
    // resample needed — the shoreline is decided per pixel from world XZ.
    this.mesh.position.x = cam.x;
    this.mesh.position.z = cam.z;
  }
}
