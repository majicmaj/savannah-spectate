import * as THREE from "three";
import { GatewayClient } from "./net/gateway_client.js";
import { WorldView } from "./render/world_view.js";
import { AnimalModels } from "./render/animal_models.js";
import { SpectateCamera } from "./render/spectate_camera.js";
import { WORLD_SIZE, SPECIES_LABELS, SPECTATE_GATEWAY_PORT } from "./world/constants.js";

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
scene.fog = new THREE.Fog(0x8fbcd4, 140, 460);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 30, 60);

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
sun.shadow.camera.far = 400;
scene.add(sun);
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
sun.target = sunTarget;

// ground placeholder (replaced by real voxel terrain in the next milestone)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
  new THREE.MeshToonMaterial({ color: 0x6f8a4a }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 27; // ~VOXEL_HEIGHT_BASE so animals (server py) sit near it
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(WORLD_SIZE, 64, 0x55703f, 0x55703f);
grid.position.y = 27.02;
(grid.material as THREE.Material).opacity = 0.2;
(grid.material as THREE.Material).transparent = true;
scene.add(grid);

const view = new WorldView();
scene.add(view.group);
const models = new AnimalModels();
scene.add(models.group);
const spectate = new SpectateCamera(camera);

let modelStatus = "loading models…";
models.load((d, t) => (modelStatus = `loading models ${d}/${t}`)).then(() => (modelStatus = "models ready"));

let status = "connecting";
const client = new GatewayClient(gatewayUrl());
client.onStatus = (s) => (status = s);
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

  // models first (uses last-frame positions), then capsules skip the modeled ids
  models.update(dt, targetPos, view.entities());
  view.setSuppressed(models.suppressed);
  view.update(dt);
  spectate.update(dt, view);

  // keep the shadow frustum near the action
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
    `entities ${view.count()}   models ${models.activeCount()}   FPS ${fps.toFixed(0)}\n` +
    `target ${targetLabel}`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
