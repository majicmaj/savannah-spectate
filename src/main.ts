import * as THREE from "three";
import { GatewayClient } from "./net/gateway_client.js";
import { WorldView } from "./render/world_view.js";
import { AnimalModels } from "./render/animal_models.js";
import { SpectateCamera } from "./render/spectate_camera.js";
import { Terrain } from "./render/terrain.js";
import { Grass } from "./render/grass.js";
import { Trees } from "./render/trees.js";
import { Heightmap } from "./world/heightmap.js";
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
const client = new GatewayClient(gatewayUrl());
client.onStatus = (s) => (status = s);
client.onHeightmap = (payload) => {
  heightmap.ingest(payload);
  terrain.setHeightmap(heightmap);
  grass.setHeightmap(heightmap);
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
let fps = 0, fpsAccum = 0, fpsFrames = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const tid = spectate.targetId;
  const targetPos = tid != null ? view.getRenderPos(tid) : null;

  if (treesLoaded && heightmap.loaded) trees.place(heightmap);

  models.update(dt, targetPos, view.entities());
  view.setSuppressed(models.suppressed);
  view.update(dt, targetPos ?? undefined, RENDER_RADIUS_M);
  terrain.update(dt, targetPos);
  grass.update(targetPos);
  spectate.update(dt, view);

  if (targetPos) {
    sun.position.set(targetPos.x + 80, targetPos.y + 160, targetPos.z + 60);
    sunTarget.position.copy(targetPos);
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

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
