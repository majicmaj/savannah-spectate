// Mutable runtime settings, adjusted by the Esc menu and read by the render/audio
// systems each frame. Defaults mirror the constants.

import { RENDER_RADIUS_M, CHUNK_RENDER_RADIUS } from "./world/constants.js";

export const settings = {
  // audio (0..1) — read by the audio system's gain nodes
  masterVol: 0.8,
  musicVol: 0.45,
  sfxVol: 0.9,
  ambientVol: 0.6,
  // visual
  chunkRadius: CHUNK_RENDER_RADIUS, // terrain chunk render radius (chunks)
  renderRadiusM: RENDER_RADIUS_M, // grass/cull/fog radius (m)
  fov: 60,
  shadows: true,
};

export type Settings = typeof settings;
