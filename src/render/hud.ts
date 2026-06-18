// Bottom HUD bars for the focused animal, matching the game's HUD:
// Health / Stamina / Food / Water / Sleep / Growth. Colors from world.tscn
// StyleBoxes. Growth is derived per-species (net.gd:30198). Toggle with H.

import type { EntStats } from "./world_view.js";
import { ANIMAL_BABY_SIZE, ANIMAL_ADULT_SIZE, SPECIES_LABELS } from "../world/constants.js";

interface Bar { key: string; label: string; color: string; fill: HTMLDivElement; pct: HTMLDivElement; }

const FRAME = "rgb(248,185,92)";
const BG = "rgba(26,20,15,0.72)";
const BARS: { key: string; label: string; color: string }[] = [
  { key: "health", label: "Health", color: "rgb(128,46,41)" },
  { key: "stamina", label: "Stamina", color: "rgb(158,128,51)" },
  { key: "food", label: "Food", color: "rgb(141,82,36)" },
  { key: "water", label: "Water", color: "rgb(77,107,117)" },
  { key: "sleep", label: "Sleep", color: "rgb(107,92,140)" },
  { key: "growth", label: "Growth", color: "rgb(107,115,51)" },
];

export class Hud {
  private root: HTMLDivElement;
  private title: HTMLDivElement;
  private subtitle: HTMLDivElement;
  private bars: Bar[] = [];

  constructor() {
    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9;" +
      "display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;" +
      "font:12px/1.3 ui-monospace,Menlo,monospace;color:#f3e9dd;text-shadow:0 1px 2px #000a;";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:bold;letter-spacing:0.5px;font-size:14px;";
    root.appendChild(title);
    this.title = title;
    const subtitle = document.createElement("div");
    subtitle.style.cssText = "font-size:11px;opacity:0.8;margin-bottom:3px;letter-spacing:0.3px;";
    root.appendChild(subtitle);
    this.subtitle = subtitle;

    const rowEl = document.createElement("div");
    rowEl.style.cssText = "display:flex;gap:8px;";
    for (const b of BARS) {
      const cell = document.createElement("div");
      cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;";
      const lab = document.createElement("div");
      lab.textContent = b.label;
      lab.style.cssText = "font-size:10px;opacity:0.85;";
      const track = document.createElement("div");
      track.style.cssText =
        `position:relative;width:96px;height:14px;background:${BG};border:1px solid ${FRAME};border-radius:2px;overflow:hidden;`;
      const fill = document.createElement("div");
      fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0%;background:${b.color};`;
      const pct = document.createElement("div");
      pct.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;";
      track.appendChild(fill);
      track.appendChild(pct);
      cell.appendChild(lab);
      cell.appendChild(track);
      rowEl.appendChild(cell);
      this.bars.push({ key: b.key, label: b.label, color: b.color, fill, pct });
    }
    root.appendChild(rowEl);
    document.body.appendChild(root);
    this.root = root;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? "flex" : "none";
  }

  update(stats: EntStats | null, name: string, status: string): void {
    if (!stats) {
      this.title.textContent = "—";
      this.subtitle.textContent = "";
      for (const b of this.bars) { b.fill.style.width = "0%"; b.pct.textContent = ""; }
      return;
    }
    this.title.textContent = name || (SPECIES_LABELS[stats.animal] ?? "?");
    this.subtitle.textContent = status;
    const vals: Record<string, number> = {
      health: stats.hpMax > 0 ? stats.hp / stats.hpMax : 0,
      stamina: stats.stamina,
      food: stats.hunger,
      water: stats.thirst,
      sleep: stats.sleep,
      growth: this.growth(stats),
    };
    for (const b of this.bars) {
      const v = Math.max(0, Math.min(1, vals[b.key] ?? 0));
      b.fill.style.width = (v * 100).toFixed(0) + "%";
      b.pct.textContent = Math.round(v * 100) + "%";
    }
  }

  private growth(s: EntStats): number {
    const roll = s.sizeRoll || 1;
    const baby = (ANIMAL_BABY_SIZE[s.animal] ?? 0.4) * roll;
    const adult = (ANIMAL_ADULT_SIZE[s.animal] ?? 2.0) * roll;
    return Math.max(0, Math.min(1, (s.size - baby) / Math.max(0.0001, adult - baby)));
  }
}
