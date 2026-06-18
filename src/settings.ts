// Mutable runtime settings, adjusted by the Esc menu and read by the render/audio
// systems each frame. Defaults mirror the constants; resetSettings() restores them.

import { RENDER_RADIUS_M, CHUNK_RENDER_RADIUS } from "./world/constants.js";

function defaults() {
  return {
    // audio (0..1) — read by the audio system's gain nodes
    masterVol: 0.8,
    musicVol: 0.45,
    sfxVol: 0.9,
    ambientVol: 0.6,
    // HUD overlays (off by default for a clean view; toggled in the Esc menu)
    showStats: false, // top-left debug text (#hud)
    showHelp: false, // bottom-right hint line (#help)
    showVitals: true, // bottom-center target vitals bar
    // visual
    chunkRadius: CHUNK_RENDER_RADIUS, // terrain chunk render radius (chunks)
    renderRadiusM: RENDER_RADIUS_M, // grass/cull/fog radius (m)
    fov: 60,
    shadows: true,
    cloudCover: 0.5, // manual sky cloud coverage 0(clear)..1(overcast) when weatherClouds is off
    weatherClouds: true, // drive cloud cover from the live weather (wetness/rain) instead of the slider
    rain: true, // render rain when the weather reports precipitation
    dust: true, // kick up dust under running animals
    fireflies: true, // night-time firefly motes
    hitFx: true, // hit-impact burst + floating damage numbers
    callBubbles: true, // overhead "Hi!/Danger!/..." bubbles when animals vocalize
    waveHeight: 0.22, // water vertex-displacement wave amplitude (m)
    waterReflect: 1.0, // water env-reflection strength 0(matte)..1(mirror)
    fpsCap: 0, // target FPS; 0 = uncapped (renders every animation frame / native refresh)
    vsync: true, // true → rAF (locked to display refresh); false → timer loop (free-run, paced by fpsCap)
  };
}

export const settings = defaults();

/** Restore every setting to its default (used by the Esc menu's reset button). */
export function resetSettings(): void {
  Object.assign(settings, defaults());
}

export type Settings = typeof settings;
