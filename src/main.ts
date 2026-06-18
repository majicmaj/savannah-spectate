import * as THREE from "three";
import { GatewayClient } from "./net/gateway_client.js";
import { WorldView } from "./render/world_view.js";
import { AnimalModels } from "./render/animal_models.js";
import { SpectateCamera } from "./render/spectate_camera.js";
import { Terrain } from "./render/terrain.js";
import { Grass } from "./render/grass.js";
import { Trees } from "./render/trees.js";
import { Water } from "./render/water.js";
import { Sky } from "./render/sky.js";
import { Rain } from "./render/rain.js";
import { Dust } from "./render/dust.js";
import { Fireflies } from "./render/fireflies.js";
import { DamageNumbers } from "./render/damage_numbers.js";
import { CallBubbles } from "./render/call_bubbles.js";
import { HitJuice } from "./render/hit_juice.js";
import { CorpseModels } from "./render/corpse_models.js";
import { Hud } from "./render/hud.js";
import { EscMenu } from "./render/esc_menu.js";
import { PlayerMenu } from "./render/player_menu.js";
import type { RosterEntry } from "./net/gateway_client.js";
import { AudioSys } from "./render/audio.js";
import { settings } from "./settings.js";
import { Heightmap } from "./world/heightmap.js";
import { computeDayNight, CYCLE_SECONDS } from "./world/daynight.js";
import {
  WORLD_SIZE, SPECIES_LABELS, AI_STATE_LABELS, SPECTATE_GATEWAY_PORT, SPECTATE_GATEWAY_WSS, RENDER_RADIUS_M, VOXEL_HEIGHT_BASE,
} from "./world/constants.js";

function gatewayUrl(): string {
  const m = location.hash.match(/ws=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  // served over https (production) → WSS tunnel; mixed-content blocks ws:// there
  if (location.protocol === "https:") return SPECTATE_GATEWAY_WSS;
  const host = location.hostname || "localhost";
  return `ws://${host}:${SPECTATE_GATEWAY_PORT}`;
}

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const canvas = document.getElementById("app") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// global vibrance bump (cheap GPU-composited CSS filter; affects only the 3D canvas)
canvas.style.filter = "saturate(1.16) contrast(1.03)";
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fbcd4);
scene.fog = new THREE.Fog(0x8fbcd4, RENDER_RADIUS_M * 0.55, RENDER_RADIUS_M);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, RENDER_RADIUS_M + 120);
camera.position.set(0, 60, 90);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a7b4a, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
sun.position.set(80, 160, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 420;
scene.add(sun);
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
sun.target = sunTarget;
// moon — second directional light, active at night (no shadow, for perf)
const moon = new THREE.DirectionalLight(0x8899ff, 0);
scene.add(moon);
const moonTarget = new THREE.Object3D();
scene.add(moonTarget);
moon.target = moonTarget;

// placeholder ground shown until the real heightmap arrives
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
  new THREE.MeshToonMaterial({ color: 0x6f8a4a }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = VOXEL_HEIGHT_BASE;
ground.receiveShadow = true;
scene.add(ground);

const view = new WorldView();
scene.add(view.group);
const models = new AnimalModels();
scene.add(models.group);
const terrain = new Terrain();
scene.add(terrain.group);
const grass = new Grass();
scene.add(grass.mesh);
const water = new Water();
scene.add(water.mesh);
const sky = new Sky(camera.far * 0.95);
scene.add(sky.mesh);
const rain = new Rain();
scene.add(rain.mesh);
const dust = new Dust();
scene.add(dust.group);
const fireflies = new Fireflies();
scene.add(fireflies.points);
const dmgNumbers = new DamageNumbers();
scene.add(dmgNumbers.group);
const callBubbles = new CallBubbles();
scene.add(callBubbles.group);

// Reflection env map: bake the sky dome into a cube texture so the water reflects
// the live day/night sky (the "HDRI env" the reference uses, but generated from
// our own procedural sky → reflections always match what's overhead). The sky is
// put on render layer 1; a CubeCamera that sees ONLY layer 1 captures sky-only
// (no terrain/animals) cheaply. Rebaked a few times a second — the sky drifts slowly.
const SKY_LAYER = 1;
sky.mesh.layers.enable(SKY_LAYER); // still drawn on layer 0 for the main camera
const envRT = new THREE.WebGLCubeRenderTarget(256, {
  generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});
const envCam = new THREE.CubeCamera(0.5, 4000, envRT);
envCam.layers.set(SKY_LAYER);
water.setEnvMap(envRT.texture);
let lastEnvBake = -1;

const trees = new Trees();
scene.add(trees.group);
const hitJuice = new HitJuice();
scene.add(hitJuice.group);
const corpseModels = new CorpseModels();
scene.add(corpseModels.group);
corpseModels.load().then(() => (view.corpsesExternal = true)).catch((e) => console.error("[corpse] load", e));
const bottomHud = new Hud();
const helpEl = document.getElementById("help") as HTMLDivElement;

const escMenu = new EscMenu();
function applySettings() {
  camera.fov = settings.fov;
  camera.far = settings.renderRadiusM + 140;
  camera.updateProjectionMatrix();
  renderer.shadowMap.enabled = settings.shadows;
  water.config({ waveHeight: settings.waveHeight, reflectivity: settings.waterReflect });
  // HUD overlay visibility (top-left stats, bottom-right hint, bottom vitals bar)
  hud.style.display = settings.showStats ? "" : "none";
  helpEl.style.display = settings.showHelp ? "" : "none";
  bottomHud.setVisible(settings.showVitals);
  if (scene.fog) { (scene.fog as THREE.Fog).near = settings.renderRadiusM * 0.55; (scene.fog as THREE.Fog).far = settings.renderRadiusM; }
}
escMenu.onApply = applySettings;
applySettings();

const playerMenu = new PlayerMenu();
playerMenu.onSpectate = (id) => spectate.setTarget(id);

const audio = new AudioSys();
audio.attach(camera);
// browsers block audio until a user gesture
const startAudio = () => { audio.start(); window.removeEventListener("pointerdown", startAudio); window.removeEventListener("keydown", startAudio); };
window.addEventListener("pointerdown", startAudio);
window.addEventListener("keydown", startAudio);
let eatTimer = 0;
const _tmpVec = new THREE.Vector3();
const heightmap = new Heightmap();
const spectate = new SpectateCamera(camera);
const lastCenter = new THREE.Vector3(0, VOXEL_HEIGHT_BASE, 0);

// Loading veil — keep it up (rendering behind it) until terrain + models + the
// first snapshot are all in, so the first frames never flash partial/artifacted.
const loadingEl = document.getElementById("loading") as HTMLDivElement;
let rdyHeight = false, rdyModels = false, rdySnap = false, revealed = false;
function maybeReveal(): void {
  if (revealed || !(rdyHeight && rdyModels && rdySnap)) return;
  revealed = true;
  loadingEl.classList.add("hide");
  setTimeout(() => (loadingEl.style.display = "none"), 700);
}
setTimeout(() => { rdyHeight = rdyModels = rdySnap = true; maybeReveal(); }, 9000); // failsafe

let modelStatus = "loading models…";
models.load((d, t) => (modelStatus = `models ${d}/${t}`)).then(() => { modelStatus = "models ready"; rdyModels = true; maybeReveal(); });
let treesLoaded = false;
trees.load().then(() => (treesLoaded = true)).catch((e) => console.error("[trees] load failed", e));

let status = "connecting";
let terrainStatus = "no heightmap";
let timeOfDay = CYCLE_SECONDS * 0.35; // default morning until first server time
let timeRecvAt = performance.now();
const client = new GatewayClient(gatewayUrl());
client.onStatus = (s) => (status = s);
client.onTime = (t) => { timeOfDay = t; timeRecvAt = performance.now(); };
client.onHeightmap = (payload) => {
  heightmap.ingest(payload);
  terrain.setHeightmap(heightmap);
  grass.setHeightmap(heightmap);
  water.setHeightmap(heightmap);
  fireflies.setHeightmap(heightmap);
  spectate.setHeightmap(heightmap); // keep the camera above the terrain
  view.setHeightmap(heightmap); // ground corpses on the terrain
  terrainStatus = `terrain ${heightmap.W}×${heightmap.H}`;
  ground.visible = false; // real terrain takes over
  rdyHeight = true; maybeReveal();
};
// live weather (smoothed toward each snapshot so cloud cover / rain ease in/out)
let weatherRain = 0;
let weatherWetness = 0;
const windDir = new THREE.Vector2(1, 0); // shared grass/tree sway direction
let roster = new Map<number, RosterEntry>(); // id → {name, isPlayer} from FRAME_ROSTER
// net "ping": snapshot inter-arrival interval, averaged over a window with min/max.
// (The gateway is push-only — this is stream latency/jitter, not true RTT.)
const NET_WINDOW_MS = 3000;
const netSamples: { t: number; v: number }[] = [];
let prevSnapAt = 0;
let netLastCompute = 0;
let netDisplay = "—";
client.onSnapshot = (snap) => {
  view.applySnapshot(snap, performance.now());
  spectate.ensureTarget(view);
  weatherRain += (snap.rain - weatherRain) * 0.25;
  weatherWetness += (snap.wetness - weatherWetness) * 0.25;
  if (!rdySnap) { rdySnap = true; maybeReveal(); }
  // sample the inter-snapshot interval; recompute the smoothed avg/min/max ~1/s
  const tnow = performance.now();
  if (prevSnapAt) netSamples.push({ t: tnow, v: tnow - prevSnapAt });
  prevSnapAt = tnow;
  const cutoff = tnow - NET_WINDOW_MS;
  while (netSamples.length && netSamples[0].t < cutoff) netSamples.shift();
  if (tnow - netLastCompute > 1000 && netSamples.length) {
    netLastCompute = tnow;
    let sum = 0, mn = Infinity, mx = 0;
    for (const s of netSamples) { sum += s.v; if (s.v < mn) mn = s.v; if (s.v > mx) mx = s.v; }
    netDisplay = `${Math.round(sum / netSamples.length)} (${Math.round(mn)}–${Math.round(mx)}) ms`;
  }
};
client.onRoster = (r) => { roster = r; if (playerMenu.visible) playerMenu.rebuild(roster, view); };
client.connect();

window.addEventListener("keyup", (e) => { if (e.key === "Tab") playerMenu.hide(); });

window.addEventListener("keydown", (e) => {
  if (e.key === "Tab") { e.preventDefault(); if (!playerMenu.visible) playerMenu.show(roster, view); return; }
  if (e.key === "Escape") escMenu.toggle();
  else if (e.key === "r" || e.key === "R") spectate.random(view);
  else if (e.key === "h" || e.key === "H") {
    // quick-toggle the top-left debug stats; keep the menu checkbox in sync
    settings.showStats = !settings.showStats;
    applySettings();
    escMenu.refresh();
  }
  else if (e.key === "F5") { spectate.flip(); e.preventDefault(); } // face animal / behind
  else if (e.key === "[") spectate.step(view, -1);
  else if (e.key === "]") spectate.step(view, +1);
  else if (e.key === "ArrowLeft") { spectate.arrows.left = true; e.preventDefault(); }
  else if (e.key === "ArrowRight") { spectate.arrows.right = true; e.preventDefault(); }
  else if (e.key === "ArrowUp") { spectate.arrows.up = true; e.preventDefault(); }
  else if (e.key === "ArrowDown") { spectate.arrows.down = true; e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft") spectate.arrows.left = false;
  else if (e.key === "ArrowRight") spectate.arrows.right = false;
  else if (e.key === "ArrowUp") spectate.arrows.up = false;
  else if (e.key === "ArrowDown") spectate.arrows.down = false;
});
let dragX = 0, dragY = 0;
canvas.addEventListener("mousedown", (e) => { spectate.dragging = true; dragX = e.clientX; dragY = e.clientY; });
window.addEventListener("mousemove", (e) => {
  if (!spectate.dragging) return;
  spectate.dragOrbit(e.clientX - dragX, e.clientY - dragY);
  dragX = e.clientX; dragY = e.clientY;
});
window.addEventListener("mouseup", () => { spectate.dragging = false; });
window.addEventListener("wheel", (e) => spectate.zoom(e.deltaY), { passive: true });
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
let lastDrawn = performance.now();
let lastCenterSent = 0;
let fps = 0, fpsAccum = 0, fpsFrames = 0;
function frame(now: number) {
  // Schedule the next tick. VSync on → requestAnimationFrame (locked to the
  // display refresh). VSync off → a timer loop driven from the tail below
  // (free-run, decoupled from refresh). Exactly one is in flight at a time, so
  // toggling vsync just changes the next tick's driver — no double loop.
  if (settings.vsync) requestAnimationFrame(frame);
  // VSync-on throttle: rAF oversamples the cap, so skip frames to hit the target.
  // (1ms slack so we don't skip the vsync we're actually aiming for.) When vsync
  // is off the timer paces us instead, so this guard is bypassed.
  if (settings.vsync && settings.fpsCap > 0 && now - lastDrawn < 1000 / settings.fpsCap - 1) return;
  lastDrawn = now;

  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // 1. interpolate ALL entities first → fresh positions for models + camera this
  //    frame (avoids the 1-frame model/camera desync). Cull center uses last
  //    frame's target (slack within the 280m radius).
  view.update(now, lastCenter, settings.renderRadiusM);

  const tid = spectate.targetId;
  const targetPos = tid != null ? view.getRenderPos(tid) : null;
  if (targetPos) lastCenter.copy(targetPos);

  // anchor server AI/physics LOD at the spectate target so nearby bots tick at
  // full rate (smooth) instead of the ~2 Hz far-bot step. ~10 Hz uplink.
  if (targetPos && now - lastCenterSent > 100) {
    client.sendCenter(targetPos.x, targetPos.z);
    lastCenterSent = now;
  }

  if (treesLoaded && heightmap.loaded) trees.place(heightmap);

  // 2. models use the fresh positions; set suppression for next frame's capsules
  models.update(dt, targetPos, view.entities());
  view.setSuppressed(models.suppressed);
  terrain.update(dt, targetPos);
  grass.update(targetPos);
  spectate.update(dt, view);
  grass.updateAlpha(camera.position, targetPos, dt); // fade grass off the subject (eased)
  if (corpseModels.loaded) corpseModels.update(view.entities().filter((e) => e.isCorpse));
  hitJuice.update(dt);
  // run dust: emit under fast-moving animals near the camera, then age the pool
  if (settings.dust) {
    for (const e of view.entities()) {
      if (e.isCorpse) continue;
      dust.emit(dt, e.x, e.y, e.z, Math.max(0.5, e.size), e.speed, e.yaw);
    }
  }
  dust.update(dt);

  // live in-game clock + day phase (drives day/night below + the bottom HUD)
  const tNorm = ((((timeOfDay + (now - timeRecvAt) / 1000) % CYCLE_SECONDS) / CYCLE_SECONDS) + 1) % 1;
  const hh24 = tNorm * 24, hh = Math.floor(hh24) % 24, mm = Math.floor((hh24 - Math.floor(hh24)) * 60);
  const clock = `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
  const phase = tNorm < 0.24 || tNorm >= 0.85 ? "Night" : tNorm < 0.32 ? "Dawn" : tNorm < 0.70 ? "Day" : tNorm < 0.78 ? "Dusk" : "Night";
  // bottom HUD: species name + live "<state> · <clock> <phase>" status
  const binfo = tid != null ? view.getEntityInfo(tid) : null;
  const aiLabel = binfo && !binfo.isCorpse ? (AI_STATE_LABELS[binfo.aiState] ?? "") : "";
  const rName = tid != null ? roster.get(tid)?.name : undefined; // real game name (players + bots)
  const bName = binfo
    ? (binfo.isCorpse ? "Carcass" : (rName || SPECIES_LABELS[binfo.animal] || "Animal"))
    : "";
  const bStatus = [aiLabel, `${clock} ${phase}`].filter(Boolean).join("   ·   ");
  bottomHud.update(tid != null ? view.getStats(tid) : null, bName, bStatus);

  // day/night — extrapolate time-of-day, drive sun/moon/sky/fog/ambient
  const dn = computeDayNight(tNorm);
  const anchor = targetPos ?? new THREE.Vector3(0, VOXEL_HEIGHT_BASE, 0);
  sun.color.setRGB(dn.sunColor[0], dn.sunColor[1], dn.sunColor[2]);
  sun.intensity = dn.sunEnergy * 3.0;
  sun.visible = dn.sunDir.y > 0.02;
  sun.castShadow = dn.sunDir.y > 0.08;
  sun.position.set(anchor.x + dn.sunDir.x * 220, anchor.y + dn.sunDir.y * 220 + 10, anchor.z + dn.sunDir.z * 220);
  sunTarget.position.copy(anchor);
  moon.color.setRGB(dn.moonColor[0], dn.moonColor[1], dn.moonColor[2]);
  moon.intensity = dn.moonEnergy * 2.2;
  moon.visible = dn.moonDir.y > 0.02;
  moon.position.set(anchor.x + dn.moonDir.x * 220, anchor.y + dn.moonDir.y * 220 + 10, anchor.z + dn.moonDir.z * 220);
  moonTarget.position.copy(anchor);
  hemi.color.setRGB(dn.ambientColor[0], dn.ambientColor[1], dn.ambientColor[2]);
  hemi.groundColor.setRGB(dn.ambientColor[0] * 0.4, dn.ambientColor[1] * 0.4, dn.ambientColor[2] * 0.4);
  hemi.intensity = dn.ambientEnergy * 3.0 + 0.12;
  (scene.background as THREE.Color).setRGB(dn.skyColor[0], dn.skyColor[1], dn.skyColor[2]);
  // fog slightly darker than the sky horizon → distant terrain reads with depth
  // instead of washing out, while staying close enough to blend.
  scene.fog!.color.setRGB(dn.fogColor[0] * 0.82, dn.fogColor[1] * 0.82, dn.fogColor[2] * 0.82);

  water.update(now / 1000, camera.position, dn.sunDir, dn.sunColor, dn.skyColor, dn.daylight);
  // cloud cover: follow the live weather (wet season → overcast, rain → heavy) or
  // the manual slider when weather-driven clouds are disabled.
  const cover = settings.weatherClouds
    ? Math.min(1, 0.18 + weatherWetness * 0.55 + weatherRain * 0.5)
    : settings.cloudCover;
  // sky dome: zenith = sky color, horizon = fog color (so terrain edge blends in)
  sky.update(now / 1000, camera.position, dn.sunDir, dn.sunColor, dn.skyColor, dn.fogColor, dn.daylight, cover, dn.moonDir, dn.moonColor, dn.moonEnergy);
  // rain follows the weather `rain` field; wind drift reuses the sun azimuth for a slant
  rain.setIntensity(weatherRain);
  rain.update(now / 1000, camera.position, dn.sunDir.x, dn.sunDir.z, settings.rain);
  // fireflies fade in at dusk (daylight 0.42 → 0.16 = full), like the game
  const nightFactor = settings.fireflies ? 1 - smoothstep01(0.16, 0.42, dn.daylight) : 0;
  fireflies.update(now / 1000, camera.position, nightFactor);

  // shared wind: slowly drifting direction + a gust envelope (stronger when raining),
  // driving grass + tree sway so the whole field leans coherently.
  const wAng = Math.sin(now * 0.00004) * Math.PI;
  windDir.set(Math.cos(wAng), Math.sin(wAng));
  const gust = 0.5 + 0.5 * Math.sin(now * 0.0011) * Math.sin(now * 0.00037 + 1.3);
  const windStr = (0.55 + 0.8 * Math.max(0, gust)) * (1 + weatherRain * 0.7);
  grass.setWind(now / 1000, windDir, windStr);
  trees.setWind(now / 1000, windDir, windStr);
  // rebake the sky→cube env for water reflections (sky is positioned above, so bake after its update)
  if (now - lastEnvBake > 400) { envCam.position.copy(camera.position); envCam.update(renderer, scene); lastEnvBake = now; }

  // audio: music/ambient day-night, calls, hit impacts (+ juice), eating
  const night = dn.daylight < 0.35;
  audio.update(dt, night, camera.position);
  const callR2 = settings.callRadius * settings.callRadius;
  for (const c of view.consumeCalls()) {
    audio.playCall(c.animal, c.callType, _tmpVec.set(c.x, c.y, c.z));
    // only show call text near the spectated animal (perf + relevance)
    if (settings.callBubbles && targetPos &&
        (c.x - targetPos.x) ** 2 + (c.z - targetPos.z) ** 2 < callR2) {
      callBubbles.spawn(c.x, c.y, c.z, c.callType);
    }
  }
  callBubbles.update(dt);
  for (const h of view.consumeHits()) {
    if (settings.hitFx) {
      hitJuice.spawn(h.x, h.y, h.z, h.amount);
      dmgNumbers.spawn(h.x, h.y + 0.4, h.z, h.amount);
    }
    audio.playHit(_tmpVec.set(h.x, h.y, h.z), Math.min(1, h.amount / 8));
  }
  dmgNumbers.update(dt);
  eatTimer += dt;
  if (eatTimer > 0.5 && targetPos) {
    eatTimer = 0;
    let best: THREE.Vector3 | null = null;
    let bestD = 45 * 45;
    for (const e of view.entities()) {
      if (e.isCorpse || (e.aiState !== 4 && e.aiState !== 16)) continue;
      const d = (e.x - camera.position.x) ** 2 + (e.z - camera.position.z) ** 2;
      if (d < bestD) { bestD = d; best = _tmpVec.set(e.x, e.y, e.z); }
    }
    if (best) audio.playEat(best);
  }

  renderer.render(scene, camera);

  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) { fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }

  // top-left debug stats — only built when shown (toggle: Esc → HUD, or H key).
  // "net" = age of the most recent snapshot (ms); the gateway is push-only, so
  // it's liveness, not true RTT.
  if (settings.showStats) {
    const fresh = client.lastSnapshotAt && now - client.lastSnapshotAt < 1000;
    const targetLabel = binfo && !binfo.isCorpse
      ? `${SPECIES_LABELS[binfo.animal] ?? "?"} #${tid} (size ${binfo.size.toFixed(1)})${aiLabel ? ` · ${aiLabel}` : ""}`
      : "—";
    hud.textContent =
      `${status}${fresh ? "" : " (stale)"}  ${(client.bytesPerSec / 1024).toFixed(1)} KB/s  ${modelStatus}\n` +
      `${terrainStatus}  chunks ${terrain.chunkCount()}  grass ${grass.count()}\n` +
      `entities ${view.count()}   models ${models.activeCount()}   FPS ${fps.toFixed(0)}\n` +
      `loc ${anchor.x.toFixed(0)}, ${anchor.z.toFixed(0)}   ${clock} ${phase}   net ${netDisplay}\n` +
      `target ${targetLabel}`;
  }

  // VSync off: free-run via timer. Pace to the FPS cap if set (delay = remaining
  // time to the next target frame, measured after this frame's work), else ASAP
  // (browsers clamp nested timers to ~4 ms ≈ 250 fps). rAF is not used here.
  if (!settings.vsync) {
    const delay = settings.fpsCap > 0
      ? Math.max(0, 1000 / settings.fpsCap - (performance.now() - lastDrawn))
      : 0;
    setTimeout(() => frame(performance.now()), delay);
  }
}
requestAnimationFrame(frame);
