// Link the shared game assets into public/ before dev/build. The viewer reuses
// the game's textures/models/sounds/assets rather than duplicating them, but the
// link targets are machine-specific, so they are NOT committed (see .gitignore).
// This script (re)creates them from GAME_DIR — set it explicitly, or let the
// fallback find the game repo as a sibling / known location.
//
// Run automatically via the `prebuild`/`predev` npm hooks.

import { existsSync, symlinkSync, rmSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, ".."); // savannah-spectate/
const dirs = ["assets", "models", "sounds", "textures"];

// resolution order: $GAME_DIR, then common sibling/box/mac locations
const candidates = [
  process.env.GAME_DIR,
  resolve(repo, "../savannah"),
  resolve(repo, "../savanah"),
  "/home/majd/savanah",
  "/Users/majd/Projects/godot/savannah",
].filter(Boolean);

const gameDir = candidates.find((c) => dirs.every((d) => existsSync(resolve(c, d))));
if (!gameDir) {
  console.error(`[link-assets] no game asset dir found. Set GAME_DIR. Tried:\n  ${candidates.join("\n  ")}`);
  process.exit(1);
}

for (const d of dirs) {
  const link = resolve(repo, "public", d);
  const target = resolve(gameDir, d);
  try { if (lstatSync(link, { throwIfNoEntry: false })) rmSync(link, { recursive: true, force: true }); } catch { /* none */ }
  symlinkSync(target, link, "dir");
}
console.log(`[link-assets] linked public/{${dirs.join(",")}} → ${gameDir}`);
