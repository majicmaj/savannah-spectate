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
import { HitJuice } from "./render/hit_juice.js";
import { CorpseModels } from "./render/corpse_models.js";
import { Hud } from "./render/hud.js";
import { EscMenu } from "./render/esc_menu.js";
import { AudioSys } from "./render/audio.js";
import { settings } from "./settings.js";
import { Heightmap } from "./world/heightmap.js";
import { computeDayNight, CYCLE_SECONDS } from "./world/daynight.js";
import {
  WORLD_SIZE, SPECIES_LABELS, SPECTATE_GATEWAY_PORT, RENDER_RADIUS_M, VOXEL_HEIGHT_BASE,
} from "./world/constants.js";

function gatewayUrl(): string {
  const m = location.hash.match(/ws=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  const host = location.hostname || "localhost";
  return `ws://${host}:${SPECTATE_GATEWAY_PORT}`;
}

const canvas = document.getElementById("app") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
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
const trees = new Trees();
scene.add(trees.group);
const hitJuice = new HitJuice();
scene.add(hitJuice.group);
const corpseModels = new CorpseModels();
scene.add(corpseModels.group);
corpseModels.load().then(() => (view.corpsesExternal = true)).catch((e) => console.error("[corpse] load", e));
const bottomHud = new Hud();
const helpEl = document.getElementById("help") as HTMLDivElement;
let hudsVisible = true;

const escMenu = new EscMenu();
function applySettings() {
  camera.fov = settings.fov;
  camera.far = settings.renderRadiusM + 140;
  camera.updateProjectionMatrix();
  renderer.shadowMap.enabled = settings.shadows;
  if (scene.fog) { (scene.fog as THREE.Fog).near = settings.renderRadiusM * 0.55; (scene.fog as THREE.Fog).far = settings.renderRadiusM; }
}
escMenu.onApply = applySettings;
applySettings();

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

let modelStatus = "loading models…";
models.load((d, t) => (modelStatus = `models ${d}/${t}`)).then(() => (modelStatus = "models ready"));
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
  view.setHeightmap(heightmap); // ground corpses on the terrain
  terrainStatus = `terrain ${heightmap.W}×${heightmap.H}`;
  ground.visible = false; // real terrain takes over
};
client.onSnapshot = (snap) => {
  view.applySnapshot(snap, performance.now());
  spectate.ensureTarget(view);
};
client.connect();

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") escMenu.toggle();
  else if (e.key === "r" || e.key === "R") spectate.random(view);
  else if (e.key === "h" || e.key === "H") {
    hudsVisible = !hudsVisible;
    bottomHud.setVisible(hudsVisible);
    hud.style.display = hudsVisible ? "" : "none";
    helpEl.style.display = hudsVisible ? "" : "none";
  }
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
  grass.updateAlpha(camera.position, targetPos); // fade grass off the subject
  if (corpseModels.loaded) corpseModels.update(view.entities().filter((e) => e.isCorpse));
  hitJuice.update(dt);
  bottomHud.update(tid != null ? view.getStats(tid) : null, tid != null ? `#${tid}` : "");

  // day/night — extrapolate time-of-day, drive sun/moon/sky/fog/ambient
  const tNorm = ((((timeOfDay + (now - timeRecvAt) / 1000) % CYCLE_SECONDS) / CYCLE_SECONDS) + 1) % 1;
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
  scene.fog!.color.setRGB(dn.fogColor[0], dn.fogColor[1], dn.fogColor[2]);

  water.update(now / 1000, camera.position, dn.sunDir, dn.sunColor, dn.skyColor);
  // sky dome: zenith = sky color, horizon = fog color (so terrain edge blends in)
  sky.update(now / 1000, camera.position, dn.sunDir, dn.sunColor, dn.skyColor, dn.fogColor, dn.daylight, settings.cloudCover);

  // audio: music/ambient day-night, calls, hit impacts (+ juice), eating
  const night = dn.daylight < 0.35;
  audio.update(dt, night, camera.position);
  for (const c of view.consumeCalls()) audio.playCall(c.animal, c.callType, _tmpVec.set(c.x, c.y, c.z));
  for (const h of view.consumeHits()) {
    hitJuice.spawn(h.x, h.y, h.z, h.amount);
    audio.playHit(_tmpVec.set(h.x, h.y, h.z), Math.min(1, h.amount / 8));
  }
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

  const info = tid != null ? view.getEntityInfo(tid) : null;
  const targetLabel =
    info && !info.isCorpse ? `${SPECIES_LABELS[info.animal] ?? "?"} #${tid} (size ${info.size.toFixed(1)})` : "—";
  const fresh = client.lastSnapshotAt && now - client.lastSnapshotAt < 1000;
  hud.textContent =
    `${status}${fresh ? "" : " (stale)"}  ${(client.bytesPerSec / 1024).toFixed(1)} KB/s  ${modelStatus}\n` +
    `${terrainStatus}  chunks ${terrain.chunkCount()}  grass ${grass.count()}\n` +
    `entities ${view.count()}   models ${models.activeCount()}   FPS ${fps.toFixed(0)}\n` +
    `target ${targetLabel}`;

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
