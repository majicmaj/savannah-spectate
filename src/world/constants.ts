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
export const GRASS_FULL_HEIGHT_M = 3.0; // tuft height at food=1
// The game's crossed-quad mesh is 1.6 m wide × 0.8 m tall (2:1) and uniform-scales
// to ~3 m tall → ~6 m wide. Match that aspect so tufts read as wide bushy clumps.
export const GRASS_WIDTH_M = 6.0;
export const GRASS_FOOTPRINT_M = 7.0; // uniform xz footprint; tuft sinks to the lowest block under it
export const GRASS_VISUAL_MIN_M = 5.0; // smallest cosmetic tuft xz span
export const GRASS_VISUAL_MAX_M = 8.5; // largest cosmetic tuft xz span

// --- grass recolor (net.gd _grass_color + voxel grass shaders) ---
// Single source of truth shared by tufts (per-blade, CPU) and ground voxel
// tops/sides (per-pair midpoints). Dry = far-from-water straw, wet = near-water
// green; a column's water-proximity factor (×SCALE) lerps dry→wet. RGB 0..1+
// (values >1 are intentional over-bright tints, multiplied onto the texture).
//   source: constants.gd GRASS_TINT_* (1226-1237)
export const GRASS_TINT_DRY_A: [number, number, number] = [1.08, 0.96, 0.46]; // bright straw
export const GRASS_TINT_DRY_B: [number, number, number] = [0.86, 0.82, 0.30]; // dull straw
export const GRASS_TINT_WET_A: [number, number, number] = [0.46, 0.95, 0.24]; // bright green
export const GRASS_TINT_WET_B: [number, number, number] = [0.66, 1.06, 0.28]; // dull green
export const GRASS_TINT_WATER_SCALE = 0.5; // caps the dry→wet lerp at the water's edge
export const GRASS_WATER_GREEN_FALLOFF = 30.0; // greenness fades beyond 30 m from water
// ground voxel grass uses the per-pair midpoints (voxel_materials.gd grass_*_mid)
export const GRASS_DRY_MID: [number, number, number] = [0.97, 0.89, 0.38];
export const GRASS_WET_MID: [number, number, number] = [0.56, 1.005, 0.26];

// --- biome / POI tint (named-POI region recolor, mirrors net.gd _poi_kind_tint
//     + _build_poi_tint_mask + voxel_top.gdshader). Absolute albedo multipliers
//     per POI kind, blended into the grass base by a world-space influence mask. ---
export const POI_KIND_TINT: Record<string, [number, number, number]> = {
  pond: [0.50, 0.50, 0.26],        // damp olive shore
  grove: [0.42, 0.34, 0.20],       // shaded leaf-litter brown
  lonely_tree: [0.58, 0.48, 0.28], // mid-tan around a solitary tree
  meadow: [0.80, 0.68, 0.32],      // straw gold tall-grass
  ridge: [0.80, 0.55, 0.26],       // ochre dust / exposed earth
};
export const POI_TINT_DEFAULT: [number, number, number] = [0.55, 0.46, 0.26];
export const POI_TINT_STRENGTH = 0.55;     // voxel_top.gdshader poi_strength
export const POI_TINT_RADIUS_SCALE = 3.5;  // net.gd: region radius = gameplay radius × 3.5
export const POI_TINT_MASK_SIZE = 256;     // _POI_TINT_MASK_SIZE

// --- snapshot interpolation ---
// Render at now - INTERP_DELAY so there's always a newer sample to interpolate
// toward (snapshots arrive at 20 Hz / 50 ms). Mirrors the native client's
// render-lag buffer; trades ~0.1s latency (irrelevant for spectating) for
// continuous motion instead of ease-and-stop stutter.
export const INTERP_DELAY_MS = 125;

// Spectator gateway listens here (separate from the game's WebSocketMultiplayerPeer).
// Per-entity AI state code → human label (port of constants.gd AI_STATE_LABELS,
// keyed by the snapshot ai_state_code byte). Index = entity.aiState.
export const AI_STATE_LABELS: string[] = [
  "",                  // 0 default
  "Wandering",         // 1
  "Watching",          // 2
  "Hunting",           // 3
  "Feasting",          // 4
  "Retreating",        // 5
  "Fleeing",           // 6
  "Retaliating",       // 7
  "Defending herd",    // 8
  "Ambushing",         // 9
  "Lying in wait",     // 10
  "Returning to water",// 11
  "Drinking",          // 12
  "Basking in the sun",// 13
  "Sleeping",          // 14
  "Passed out",        // 15
  "Grazing",           // 16
  "Scouting",          // 17
  "Encircling",        // 18
  "Closing in",        // 19
  "Attacking",         // 20
  "Scavenging",        // 21
  "Lost sight",        // 22
  "Enraged",           // 23
];

export const SPECTATE_GATEWAY_PORT = 8091;
// Production gateway endpoint (WSS via the cloudflared tunnel). Used when the
// viewer is served over https; local dev still uses ws://<host>:8091.
export const SPECTATE_GATEWAY_WSS = "wss://spectate-gw.hobbyhood.app";

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

// per-species baby/adult size (m) for the growth bar (ANIMAL_STATS).
// growth = clamp((size - baby*roll) / ((adult-baby)*roll), 0, 1)
export const ANIMAL_BABY_SIZE = [0.5, 0.6, 0.4, 0.3, 0.5, 0.4, 0.25, 0.4];
export const ANIMAL_ADULT_SIZE = [2.5, 7.5, 1.5, 6.0, 2.5, 2.0, 2.0, 1.8];

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
