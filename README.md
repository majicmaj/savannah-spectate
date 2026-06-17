# savannah-spectate

A **read-only** Three.js + TypeScript spectator client for the [Savannah](../savannah) Godot game.

It connects to the game server's **spectator gateway** (a raw-WebSocket god-view
stream on a separate port), decodes the same binary snapshot format the native
client uses, and renders the living world in the browser. No input, no prediction,
no lag-comp — pure decode + render. This is the proof-of-concept for "what would a
Three.js client look/feel/perform like" without rebuilding the whole game client.

## Relationship to the game repo (read-only)

This repo **references** the game repo but never modifies it. Wire formats and
constants are **ported** here (mirrored), not imported:

| Here | Mirrors (in `../savannah`) |
| --- | --- |
| `src/net/snapshot_codec.ts` | `scripts/net/snapshot_codec.gd` (decode path, `SNAPSHOT_VERSION` 42) |
| `src/world/constants.ts` | `scripts/sim/constants.gd` (`WORLD_SIZE`, seeds, animal table) |
| frame protocol | `scripts/net/spectator_gateway.gd` (the gateway added on the test branch) |

When the game's `SnapshotCodec.SNAPSHOT_VERSION` bumps, update `snapshot_codec.ts`
to match (the decoder hard-errors on mismatch). `npm test` round-trips the codec
to catch byte-layout drift.

## Run

1. **Start the game server with the gateway** (it lives on a test branch / worktree):
   ```sh
   GODOT="/Applications/Godot.app/Contents/MacOS/Godot"
   "$GODOT" --headless --path . -- --server --port 8080
   ```
   On boot it logs `[spectate] gateway listening on :8091`. Spawn a few bots so
   there's something to watch (the AI populates the world automatically).

2. **Run the spectate client:**
   ```sh
   npm install
   npm run dev
   ```
   Open the printed localhost URL. To point at a non-local server:
   `http://localhost:5173/#ws=ws://your-host:8091`.

## Controls

| Key | Action |
| --- | --- |
| `R` | jump to a random spectate target |
| `[` / `]` | previous / next target |
| wheel | zoom in / out |

The camera chases the followed entity along its heading.

## Status

- ✅ Transport (raw-WS gateway), snapshot codec port (validated round-trip)
- ✅ Per-species `InstancedMesh` rendering (whole herd ≈ 1 draw call/species)
- ✅ Spectate camera + controls, 20 Hz snapshot → smoothed render interpolation
- ⏳ Next: deterministic terrain + grass (seeds `0xC0FFEE` / `1337`), instanced-skinned
  GLB animal models (`agargaro/instanced-mesh`), toon shader, water/POI from `world_init`

`npm test` — codec round-trip. `npm run build` — production bundle.
