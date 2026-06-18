// Performant stylized sky: one camera-following dome (BackSide sphere) with a
// procedural fragment shader. Sky is a vertical gradient (horizon=fog color →
// top=sky color) with a sun disk + glow. Clouds are cheap 2D fbm noise projected
// onto the dome (planar "cloud layer"), drifting over time, with a pseudo-
// volumetric look: a second fbm tap offset toward the sun lights the sunward
// side and shades the underside — ~95% of raymarched volumetrics at ~0 cost
// (no 3D textures, no render targets, just value-noise fbm sampled twice).
//
// Driven by the day/night cycle: pass sky top + horizon (fog) colors, sun dir +
// color, daylight fraction, and a cloud-cover setting each frame.

import * as THREE from "three";

export class Sky {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(radius: number) {
    const geo = new THREE.SphereGeometry(radius, 32, 16);
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSkyTop: { value: new THREE.Color(0x3f7feb) },
        uSkyHorizon: { value: new THREE.Color(0xc7e0fb) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff2d8) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uMoonColor: { value: new THREE.Color(0xbfd0ff) },
        uMoonEnergy: { value: 0 },
        uCloudLit: { value: new THREE.Color(0xffffff) },
        uCloudDark: { value: new THREE.Color(0x8693a0) },
        uCover: { value: 0.5 },
        uDaylight: { value: 1 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = position;                 // dome is centered on the camera → local pos = view dir
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;            // pin depth to the far plane (always behind the world)
        }`,
      fragmentShader: `
        uniform float uTime, uCover, uDaylight, uMoonEnergy;
        uniform vec3 uSkyTop, uSkyHorizon, uSunDir, uSunColor, uMoonDir, uMoonColor, uCloudLit, uCloudDark;
        varying vec3 vDir;

        // crisp square celestial body: 1 inside an angular box around bodyDir, soft edge.
        // (axis-aligned in a stable tangent frame so it reads as a pixel-art square.)
        float squareBody(vec3 dir, vec3 bodyDir, float halfSize, float soft){
          if (dot(dir, bodyDir) <= 0.0) return 0.0;
          vec3 up = abs(bodyDir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 right = normalize(cross(up, bodyDir));
          vec3 bup = cross(bodyDir, right);
          float u = dot(dir, right), v = dot(dir, bup);  // small-angle tangent offsets
          float d = max(abs(u), abs(v));
          return 1.0 - smoothstep(halfSize - soft, halfSize + soft, d);
        }

        // cheap value-noise fbm (no textures)
        float hash(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = hash(i), b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
          return v;
        }

        void main(){
          vec3 dir = normalize(vDir);
          float elev = dir.y;

          // sky gradient: horizon → top (pow biases the band toward the horizon)
          float t = clamp(elev, 0.0, 1.0);
          vec3 sky = mix(uSkyHorizon, uSkyTop, pow(t, 0.5));

          float sd = max(dot(dir, uSunDir), 0.0);  // kept for cloud rim-light below

          // square sun — crisp pixel-art block, no glowing blob. Gated above the horizon.
          float sunVis = smoothstep(-0.03, 0.06, uSunDir.y);
          sky += uSunColor * squareBody(dir, uSunDir, 0.052, 0.004) * 1.5 * sunVis;
          // square moon — same, lit by its day/night energy
          sky += uMoonColor * squareBody(dir, uMoonDir, 0.042, 0.004) * (0.7 + uMoonEnergy * 1.6);

          // clouds only above the horizon; project the view dir onto a flat layer
          float cloudMask = smoothstep(0.02, 0.16, elev);
          if (cloudMask > 0.0){
            vec2 uv = dir.xz / max(elev, 0.10);                // planar cloud-layer projection
            uv = uv * 0.55 + vec2(uTime * 0.006, uTime * 0.0035);
            float n = fbm(uv);
            // coverage: higher uCover → lower threshold → more sky filled
            float cover = smoothstep(0.62 - uCover * 0.42, 0.92 - uCover * 0.30, n);
            cover *= cloudMask;
            // pseudo-volumetric shading: density gradient toward the sun
            vec2 lstep = normalize(uSunDir.xz + vec2(1e-4)) * 0.07;
            float nl = fbm(uv + lstep);
            float shade = clamp((n - nl) * 3.2 + 0.55, 0.0, 1.0);
            vec3 cloudCol = mix(uCloudDark, uCloudLit, shade);
            // rim brighten where the cloud edge faces the sun
            cloudCol += uSunColor * pow(sd, 3.0) * 0.25 * shade;
            sky = mix(sky, cloudCol, cover * 0.92);
          }

          gl_FragColor = vec4(sky, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /**
   * @param t        seconds (drives cloud drift)
   * @param camPos   camera world position (dome follows it)
   * @param sunDir   normalized sun direction
   * @param sunColor sun color rgb 0..1
   * @param skyTop   dome zenith color rgb 0..1 (day/night sky color)
   * @param skyHorizon dome horizon color rgb 0..1 (fog color, so terrain blends in)
   * @param daylight 0(night)..1(noon)
   * @param cover    cloud cover 0..1
   */
  update(
    t: number, camPos: THREE.Vector3, sunDir: THREE.Vector3,
    sunColor: [number, number, number], skyTop: [number, number, number],
    skyHorizon: [number, number, number], daylight: number, cover: number,
    moonDir?: THREE.Vector3, moonColor?: [number, number, number], moonEnergy = 0,
  ): void {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.setRGB(sunColor[0], sunColor[1], sunColor[2]);
    if (moonDir) u.uMoonDir.value.copy(moonDir);
    if (moonColor) u.uMoonColor.value.setRGB(moonColor[0], moonColor[1], moonColor[2]);
    u.uMoonEnergy.value = moonEnergy;
    u.uSkyTop.value.setRGB(skyTop[0], skyTop[1], skyTop[2]);
    u.uSkyHorizon.value.setRGB(skyHorizon[0], skyHorizon[1], skyHorizon[2]);
    u.uDaylight.value = daylight;
    u.uCover.value = cover;
    // cloud lit/dark tints track time-of-day: bright warm by day, dim blue-grey at night
    const b = 0.32 + 0.68 * daylight;
    u.uCloudLit.value.setRGB(
      b * (0.85 + 0.15 * sunColor[0]),
      b * (0.86 + 0.14 * sunColor[1]),
      b * (0.88 + 0.12 * sunColor[2]),
    );
    u.uCloudDark.value.setRGB(b * 0.5, b * 0.54, b * 0.62);
    this.mesh.position.copy(camPos);
  }
}
