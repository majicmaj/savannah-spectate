// Ported from the game repo's scripts/sim/constants.gd (SavConst).
// This companion repo is READ-ONLY w.r.t. the game repo: values are mirrored
// here, not imported. Keep in sync when the source changes.
//   source: ../savannah/scripts/sim/constants.gd

export const WORLD_SIZE = 1024.0; // constants.gd:349
export const WORLD_HALF = WORLD_SIZE * 0.5; // 512
export const DEFAULT_GAME_PORT = 8080; // constants.gd:297

// Deterministic world seeds (not transmitted — hardcoded both sides).
export const GRASS_SEED = 0xc0ffee; // constants.gd:1194
export const VOXEL_NOISE_SEED = 1337; // constants.gd:5688
export const VOXEL_WORLD_W = 1024; // constants.gd:5683

export const SNAPSHOT_REFRESH_INTERVAL = 5; // constants.gd:3771

// --- voxel terrain (constants.gd / voxel_gen.gd / voxel_mesher.gd) ---
export const VOXEL_CHUNK = 32; // VOXEL_CHUNK_X/Z
export const VOXEL_WATER_LEVEL = 26;
export const VOXEL_HEIGHT_BASE = 27;
export const VOXEL_WATER_SURFACE_OFFSET = 0.95;
export const VOXEL_DRY_FALLOFF = 96; // m to full-dry grass tint
export const WATER_DIST_MAX = 64; // BFS cap (VoxelGen._WATER_DIST_MAX)

// terrain top/side palette (voxel_mesher.gd) — RGB 0..1
export const COL_GRASS_GREEN: [number, number, number] = [0.6, 0.55, 0.26];
export const COL_GRASS_DRY: [number, number, number] = [0.78, 0.72, 0.36];
export const COL_SAND: [number, number, number] = [0.78, 0.72, 0.48];
export const COL_MUD: [number, number, number] = [0.32, 0.26, 0.18];
export const COL_DIRT: [number, number, number] = [0.46, 0.32, 0.2];

// --- render distance (spectate-only perf knob) ---
export const RENDER_RADIUS_M = 280; // hard cull radius around the camera target
export const CHUNK_RENDER_RADIUS = 9; // chunks each way (9*32 ≈ 288 m)

// --- trees (tree_gen.gd / net.gd) ---
export const TREE_SEED = 0xacac1a;
export const TREE_COUNT = 30;
export const TREE_MODEL = "models/acaia_tree.glb";

// --- grass (grass_gen.gd) — GRASS_SEED declared above ---
export const FOOD_CAP = 40000;
export const GRASS_MIN_SPACING = 3.0;
export const GRASS_FULL_HEIGHT_M = 3.0; // GRASS_FULL_HEIGHT_M — tuft height at food=1
export const GRASS_WIDTH_M = 1.6; // build_crossed_mesh quad width

// --- snapshot interpolation ---
// Render at now - INTERP_DELAY so there's always a newer sample to interpolate
// toward (snapshots arrive at 20 Hz / 50 ms). Mirrors the native client's
// render-lag buffer; trades ~0.1s latency (irrelevant for spectating) for
// continuous motion instead of ease-and-stop stutter.
export const INTERP_DELAY_MS = 110;

// Spectator gateway listens here (separate from the game's WebSocketMultiplayerPeer).
export const SPECTATE_GATEWAY_PORT = 8091;

// animal id -> name (constants.gd:6157 SPECIES_LABELS)
export const SPECIES_LABELS = [
  "Lion", "Elephant", "Gazelle", "Crocodile", "Wildebeest", "Cheetah", "Vulture", "Hyena",
] as const;

// animal id -> glb (constants.gd:3891 ANIMAL_MODELS). res:// stripped; served from
// the game repo's models/ dir (see vite config publicDir alias / symlink in README).
export const ANIMAL_MODELS: Record<number, string> = {
  0: "models/lion.glb",
  1: "models/elephant.glb",
  2: "models/gazelle.glb",
  3: "models/crocodile.glb",
  4: "models/wildebeest.glb",
  5: "models/cheetah.glb",
  6: "models/vulture.glb",
  7: "models/hyena.glb",
};
export const LIONESS_MODEL = "models/lioness.glb";

// animal id -> placeholder color [r,g,b] 0..1 (constants.gd:6146 ANIMAL_COLORS)
export const ANIMAL_COLORS: [number, number, number][] = [
  [0.93, 0.55, 0.18], // lion
  [0.55, 0.55, 0.6], // elephant
  [0.8, 0.68, 0.45], // gazelle
  [0.28, 0.55, 0.3], // crocodile
  [0.33, 0.28, 0.23], // wildebeest
  [0.85, 0.65, 0.3], // cheetah
  [0.2, 0.18, 0.22], // vulture
  [0.52, 0.46, 0.36], // hyena
];

// Player record indices (snapshot_codec.gd empty_player_arr / _decode_p_*).
// The decoded per-entity value is a 39-slot array; these name the slots we render.
export const P = {
  PX: 0,
  PZ: 1,
  SIZE: 2,
  HP: 3,
  ANIMAL: 4,
  NAME: 6,
  STAMINA: 7,
  PY: 8,
  THIRST: 9,
  SNEAK: 10,
  HUNGER: 11,
  HP_MAX: 12,
  SIZE_ROLL: 13,
  AI_STATE: 14,
  SLEEPING: 15,
  GROUP_ID: 17,
  LAST_CALL_TYPE: 18,
  LAST_CALL_TIME: 19,
  KILLS: 20,
  RUN_SECONDS: 21,
  PERK_PENDING: 22,
  YAW: 23,
  FLIGHT_IS_REAL: 27,
  IS_FEMALE: 28,
  TINT_RED: 29,
  FLIGHT_MODE: 30,
  GRAB_KIND: 31,
  GRAB_ROLE: 32,
  GRAB_TARGET_ID: 33,
  GRAB_PROGRESS: 34,
  HEAD: 35,
  SLEEP_BAR: 36,
  IS_SUPERCHARGED: 37,
  AFFINITY: 38,
} as const;
