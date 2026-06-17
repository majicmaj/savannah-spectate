import * as THREE from "three";
import { GatewayClient } from "./net/gateway_client.js";
import { WorldView } from "./render/world_view.js";
import { SpectateCamera } from "./render/spectate_camera.js";
import { WORLD_SIZE, SPECIES_LABELS, SPECTATE_GATEWAY_PORT } from "./world/constants.js";

// --- gateway URL: #ws=ws://host:port overrides; default to this host on the gateway port ---
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
scene.fog = new THREE.Fog(0x8fbcd4, 120, 400);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 30, 60);

// --- lighting (toon-friendly) ---
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a6b3a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
sun.position.set(80, 160, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 400;
scene.add(sun);

// --- ground: the 1024x1024 toroidal world, centered at origin ---
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
  new THREE.MeshToonMaterial({ color: 0x6f9e54 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(WORLD_SIZE, 64, 0x557a3f, 0x557a3f);
(grid.material as THREE.Material).opacity = 0.25;
(grid.material as THREE.Material).transparent = true;
scene.add(grid);

const view = new WorldView();
scene.add(view.group);
const spectate = new SpectateCamera(camera);

// --- gateway ---
let status: string = "connecting";
const client = new GatewayClient(gatewayUrl());
client.onStatus = (s) => (status = s);
client.onSnapshot = (snap) => {
  view.applySnapshot(snap);
  spectate.ensureTarget(view);
};
client.connect();

// --- controls ---
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

// --- render loop ---
let last = performance.now();
let fps = 0;
let fpsAccum = 0;
let fpsFrames = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  view.update(dt);
  spectate.update(dt, view);
  renderer.render(scene, camera);

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  const tid = spectate.targetId;
  const info = tid != null ? view.getEntityInfo(tid) : null;
  const targetLabel =
    info && !info.isCorpse ? `${SPECIES_LABELS[info.animal] ?? "?"} #${tid} (size ${info.size.toFixed(1)})` : "—";
  const fresh = client.lastSnapshotAt && now - client.lastSnapshotAt < 1000;
  hud.textContent =
    `${status}${fresh ? "" : " (stale)"}  ${(client.bytesPerSec / 1024).toFixed(1)} KB/s  snaps ${client.snapshotCount}\n` +
    `entities ${view.count()}   FPS ${fps.toFixed(0)}\n` +
    `target ${targetLabel}`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
