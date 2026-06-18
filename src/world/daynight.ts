// Port of scripts/sim/day_night.gd (DayNight). Pure functions of the normalized
// day fraction t_norm = time_of_day / CYCLE_SECONDS (0 = midnight, 0.25 dawn,
// 0.5 noon, 0.75 dusk). Drives sun/moon direction+color+energy, sky/fog color,
// and ambient. The gateway streams time_of_day (seconds into [0,360)); the client
// extrapolates between updates.

import * as THREE from "three";

export const CYCLE_SECONDS = 360.0; // DAY_SECONDS 180 + NIGHT_SECONDS 180
const TAU = Math.PI * 2;

type C = [number, number, number];
const SUN_DAY: C = [1.0, 0.97, 0.9];
const SUN_DUSK: C = [1.0, 0.46, 0.15]; // deep orange sunset disk
// Horizon (fog) band — this IS the fog color, so terrain fades into the sky.
// Day = pale blue haze; dusk = vivid sunset orange; night = dim blue glow.
const SKY_FOG_DAY: C = [0.72, 0.83, 0.93];
const SKY_FOG_DUSK: C = [0.93, 0.5, 0.29];
const SKY_FOG_NIGHT: C = [0.05, 0.08, 0.17];
const AMBIENT_DAY: C = [0.84, 0.8, 0.68];
// Night ambient: cool moonlit blue, not grey.
const AMBIENT_NIGHT: C = [0.22, 0.3, 0.6];
const MOON_ZENITH: C = [0.64, 0.76, 1.12];
const MOON_HORIZON: C = [0.9, 0.84, 0.98];
// sky-dome zenith (top) colors. Day = rich sky blue; dusk = twilight blue-violet
// (so the orange horizon → violet top gradient reads as a real sunset); night =
// near-black navy for a true night feel.
const SKY_TOP_DAY: C = [0.21, 0.45, 0.85];
const SKY_TOP_DUSK: C = [0.3, 0.26, 0.48];
const SKY_TOP_NIGHT: C = [0.014, 0.03, 0.1];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
function lerpC(a: C, b: C, t: number): C {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function blend3(day: C, dusk: C, night: C, w: C): C {
  return [
    day[0] * w[0] + dusk[0] * w[1] + night[0] * w[2],
    day[1] * w[0] + dusk[1] * w[1] + night[1] * w[2],
    day[2] * w[0] + dusk[2] * w[1] + night[2] * w[2],
  ];
}

export function daylightFraction(tNorm: number): number {
  return 0.5 * (1 - Math.cos(TAU * tNorm));
}
export function sunDir(tNorm: number): THREE.Vector3 {
  const a = tNorm * TAU;
  return new THREE.Vector3(Math.sin(a), -Math.cos(a), 0).normalize();
}
function skyWeights(d: number): C {
  const night = clamp01(1 - d * 2);
  const day = clamp01(d * 2 - 1);
  const dusk = clamp01(1 - night - day);
  return [day, dusk, night];
}

export interface DayNightState {
  sunDir: THREE.Vector3;
  sunColor: C;
  sunEnergy: number;
  moonDir: THREE.Vector3;
  moonColor: C;
  moonEnergy: number;
  skyColor: C;
  fogColor: C;
  ambientColor: C;
  ambientEnergy: number;
  daylight: number;
}

export function computeDayNight(tNorm: number): DayNightState {
  const d = daylightFraction(tNorm);
  const w = skyWeights(d);
  const sd = sunDir(tNorm);
  const md = sd.clone().negate();

  const sunAbove = clamp01(sd.y);
  const warm = clamp01(1 - sunAbove * 1.4);
  const sunColor = lerpC(SUN_DAY, SUN_DUSK, warm * 0.85);

  const moonAbove = clamp01(md.y);
  const moonColor = lerpC(MOON_HORIZON, MOON_ZENITH, moonAbove);
  const moonEnergy = Math.min(0.55, Math.sqrt(moonAbove) * 0.55) * smoothstep(0, 0.06, moonAbove);

  return {
    sunDir: sd,
    sunColor,
    sunEnergy: Math.min(1.05, Math.sqrt(sunAbove) * 1.05) * smoothstep(0, 0.06, sunAbove),
    moonDir: md,
    moonColor,
    moonEnergy,
    skyColor: blend3(SKY_TOP_DAY, SKY_TOP_DUSK, SKY_TOP_NIGHT, w),
    fogColor: blend3(SKY_FOG_DAY, SKY_FOG_DUSK, SKY_FOG_NIGHT, w),
    ambientColor: lerpC(AMBIENT_NIGHT, AMBIENT_DAY, d),
    ambientEnergy: 0.12 + (0.26 - 0.12) * d,
    daylight: d,
  };
}
