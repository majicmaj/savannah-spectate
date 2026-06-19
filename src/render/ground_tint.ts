// Live ground/grass tinting that matches the game (net.gd + voxel_top.gdshader):
//   1. season/weather — dry↔wet palette gated by live wetness (1 - dryness)
//   2. biome — named-POI region recolor sampled from a world-space influence mask
//   3. day/night — sky_tint albedo overlay (warm→orange→deep-blue, rising strength)
// All three are driven by SHARED uniforms updated once per frame, so terrain chunks
// and grass tufts recolor in lockstep without rebuilding geometry.

import * as THREE from "three";
import type { DayNightState } from "../world/daynight.js";
import type { Poi } from "../world/world_init.js";
import {
  WORLD_SIZE, WORLD_HALF, POI_KIND_TINT, POI_TINT_DEFAULT,
  POI_TINT_RADIUS_SCALE, POI_TINT_MASK_SIZE,
} from "../world/constants.js";

// 1×1 transparent placeholder until POIs arrive (sampler must always be bound).
function blankPoiTex(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

export const tintUniforms = {
  uDryness: { value: 0 },
  uSkyTint: { value: new THREE.Color(0.58, 0.66, 0.7) },
  uSkyTintStr: { value: 0 },
  uPoiTex: { value: blankPoiTex() as THREE.Texture },
  uPoiHas: { value: 0 },
  uMapHalf: { value: WORLD_HALF },
  uMapSize: { value: WORLD_SIZE },
};

const COMMON_UNIFORMS =
  "uniform float uDryness, uSkyTintStr, uPoiHas, uMapHalf, uMapSize;\n" +
  "uniform vec3 uSkyTint;\nuniform sampler2D uPoiTex;\n";

function bind(shader: any): void {
  shader.uniforms.uDryness = tintUniforms.uDryness;
  shader.uniforms.uSkyTint = tintUniforms.uSkyTint;
  shader.uniforms.uSkyTintStr = tintUniforms.uSkyTintStr;
  shader.uniforms.uPoiTex = tintUniforms.uPoiTex;
  shader.uniforms.uPoiHas = tintUniforms.uPoiHas;
  shader.uniforms.uMapHalf = tintUniforms.uMapHalf;
  shader.uniforms.uMapSize = tintUniforms.uMapSize;
}

// Terrain ground/cliff materials. aBank (per-vertex) = raw water-bank proximity
// for grass faces, or <0 for dirt/sand (skip the grass palette + POI, keep texture).
export function injectTerrainTint(mat: THREE.Material): void {
  const prev = (mat as any).onBeforeCompile;
  mat.onBeforeCompile = (shader: any) => {
    if (prev) prev(shader);
    bind(shader);
    shader.vertexShader =
      "attribute float aBank;\nvarying float vBank;\nvarying vec2 vTintXZ;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
  vBank = aBank;
  vTintXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader =
      COMMON_UNIFORMS + "varying float vBank;\nvarying vec2 vTintXZ;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
  {
    vec3 _tex = diffuseColor.rgb;
    vec3 _out = _tex;
    if (vBank >= 0.0) {
      float _wt = clamp(vBank, 0.0, 1.0) * 0.5 * (1.0 - uDryness); // GRASS_TINT_WATER_SCALE
      vec3 _pal = mix(vec3(0.97, 0.89, 0.38), vec3(0.56, 1.005, 0.26), _wt); // dry_mid → wet_mid
      _out = _tex * _pal;
      if (uPoiHas > 0.5) {
        vec4 _poi = texture2D(uPoiTex, fract((vTintXZ + uMapHalf) / uMapSize));
        float _detail = (_tex.r + _tex.g + _tex.b) * 0.3333;
        vec3 _poiAlb = _poi.rgb * (0.7 + 0.6 * _detail);
        float _w = pow(clamp(_poi.a, 0.0, 1.0), 0.55) * 0.55; // poi_strength
        _out = mix(_out, _poiAlb, _w);
      }
    }
    _out = mix(_out, uSkyTint, uSkyTintStr);
    diffuseColor.rgb = _out;
  }`);
  };
  mat.needsUpdate = true;
}

// Grass tufts: no water-bank/POI (the game tufts skip both) — just the live weather
// shift (yellow + desaturate when dry) + the day/night sky_tint, over the baked
// per-instance colour. Injected alongside the existing wind/alpha onBeforeCompile.
export function grassTintFragment(): string {
  return `
  {
    vec3 _gc = diffuseColor.rgb;
    vec3 _dry = _gc * vec3(1.12, 1.0, 0.6);
    _gc = mix(_gc, _dry, uDryness * 0.30);
    float _lum = dot(_gc, vec3(0.299, 0.587, 0.114));
    _gc = mix(_gc, vec3(_lum), uDryness * 0.22);
    _gc = mix(_gc, uSkyTint, uSkyTintStr);
    diffuseColor.rgb = _gc;
  }`;
}
export function grassTintUniformDecl(): string {
  return "uniform float uDryness, uSkyTintStr;\nuniform vec3 uSkyTint;\n";
}
export function bindGrassTint(shader: any): void {
  shader.uniforms.uDryness = tintUniforms.uDryness;
  shader.uniforms.uSkyTint = tintUniforms.uSkyTint;
  shader.uniforms.uSkyTintStr = tintUniforms.uSkyTintStr;
}

// Build the POI influence mask (mirrors net.gd _build_poi_tint_mask): per texel,
// smoothstep-weighted blend of nearby POI kind-tints; alpha = POI dominance.
export function setPoiMask(pois: Poi[]): void {
  if (!pois.length) { tintUniforms.uPoiHas.value = 0; return; }
  const size = POI_TINT_MASK_SIZE;
  const data = new Uint8Array(size * size * 4);
  const step = WORLD_SIZE / size;
  const px = pois.map((p) => p.x);
  const pz = pois.map((p) => p.z);
  const pr = pois.map((p) => p.radius * POI_TINT_RADIUS_SCALE);
  const pc = pois.map((p) => POI_KIND_TINT[p.kind] ?? POI_TINT_DEFAULT);
  for (let y = 0; y < size; y++) {
    const z = -WORLD_HALF + (y + 0.5) * step;
    for (let x = 0; x < size; x++) {
      const wx = -WORLD_HALF + (x + 0.5) * step;
      let tw = 0, ar = 0, ag = 0, ab = 0;
      for (let i = 0; i < pois.length; i++) {
        let dx = wx - px[i], dz = z - pz[i];
        if (dx > WORLD_HALF) dx -= WORLD_SIZE; else if (dx < -WORLD_HALF) dx += WORLD_SIZE;
        if (dz > WORLD_HALF) dz -= WORLD_SIZE; else if (dz < -WORLD_HALF) dz += WORLD_SIZE;
        const t = Math.min(1, Math.sqrt(dx * dx + dz * dz) / pr[i]);
        let w: number;
        if (t < 0.4) w = 1;
        else { const u = (t - 0.4) / 0.6; w = (1 - u) * (1 - u); }
        if (w <= 0) continue;
        ar += pc[i][0] * w; ag += pc[i][1] * w; ab += pc[i][2] * w; tw += w;
      }
      const o = (y * size + x) * 4;
      if (tw > 0) {
        const inv = 1 / tw;
        data[o] = Math.min(255, ar * inv * 255);
        data[o + 1] = Math.min(255, ag * inv * 255);
        data[o + 2] = Math.min(255, ab * inv * 255);
        data[o + 3] = Math.min(255, tw * 255);
      } // else leave 0,0,0,0 (no influence)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tintUniforms.uPoiTex.value = tex;
  tintUniforms.uPoiHas.value = 1;
}

export function updateGroundTint(dn: DayNightState, wetness: number): void {
  tintUniforms.uDryness.value = Math.min(1, Math.max(0, (1 - wetness) * 1.15)); // net.gd dryness
  tintUniforms.uSkyTint.value.setRGB(dn.skyTint[0], dn.skyTint[1], dn.skyTint[2]);
  tintUniforms.uSkyTintStr.value = dn.skyTintStr;
}
