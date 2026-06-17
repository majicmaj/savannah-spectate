import * as THREE from "three";
import { GatewayClient } from "./net/gateway_client.js";
import { WorldView } from "./render/world_view.js";
import { AnimalModels } from "./render/animal_models.js";
import { SpectateCamera } from "./render/spectate_camera.js";
import { Terrain } from "./render/terrain.js";
import { Grass } from "./render/grass.js";
import { Trees } from "./render/trees.js";
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
const trees = new Trees();
scene.add(trees.group);
const heightmap = new Heightmap();
const spectate = new SpectateCamera(camera);

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
  if (e.key === "r" || e.key === "R") spectate.random(view);
  else if (e.key === "[") spectate.step(view, -1);
  else if (e.key === "]") spectate.step(view, +1);
});
window.addEventListener("wheel", (e) => spectate.zoom(e.deltaY), { passive: true });
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
let lastCenterSent = 0;
let fps = 0, fpsAccum = 0, fpsFrames = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const tid = spectate.targetId;
  const targetPos = tid != null ? view.getRenderPos(tid) : null;

  // anchor server AI/physics LOD at the spectate target so nearby bots tick at
  // full rate (smooth) instead of the ~2 Hz far-bot step. ~10 Hz uplink.
  if (targetPos && now - lastCenterSent > 100) {
    client.sendCenter(targetPos.x, targetPos.z);
    lastCenterSent = now;
  }

  if (treesLoaded && heightmap.loaded) trees.place(heightmap);

  models.update(dt, targetPos, view.entities());
  view.setSuppressed(models.suppressed);
  view.update(now, targetPos ?? undefined, RENDER_RADIUS_M);
  terrain.update(dt, targetPos);
  grass.update(targetPos);
  spectate.update(dt, view);

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

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
