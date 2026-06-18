// Online-players panel: hold Tab to reveal a non-obstructive list on the left of
// real players (from the gateway roster's isPlayer flag) that are currently in
// the world. Click a row to spectate that player. Hidden on Tab release.

import type { WorldView } from "./world_view.js";
import { SPECIES_LABELS } from "../world/constants.js";
import type { RosterEntry } from "../net/gateway_client.js";

const AMBER = "#f8b95c";

export class PlayerMenu {
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  visible = false;
  onSpectate: ((id: number) => void) | null = null;

  constructor() {
    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:15;display:none;" +
      "min-width:200px;max-width:260px;max-height:70vh;overflow-y:auto;margin:0 0 0 12px;" +
      "padding:10px 12px;border-radius:0 10px 10px 0;background:rgba(16,21,27,0.82);" +
      `border:1px solid ${AMBER}40;border-left:none;box-shadow:0 6px 30px #0008;` +
      "font:12px/1.4 ui-monospace,Menlo,monospace;color:#eef3f7;";
    const title = document.createElement("div");
    title.textContent = "Online players";
    title.style.cssText = `font-weight:bold;color:${AMBER};font-size:12px;letter-spacing:.5px;margin-bottom:8px;`;
    root.appendChild(title);
    const list = document.createElement("div");
    root.appendChild(list);
    this.list = list;
    document.body.appendChild(root);
    this.root = root;
  }

  show(roster: Map<number, RosterEntry>, view: WorldView): void {
    this.visible = true;
    this.root.style.display = "block";
    this.rebuild(roster, view);
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  // Rebuild the row list — only real players that currently exist in the world.
  rebuild(roster: Map<number, RosterEntry>, view: WorldView): void {
    if (!this.visible) return;
    this.list.replaceChildren();
    const rows: { id: number; name: string; animal: number }[] = [];
    for (const [id, e] of roster) {
      if (!e.isPlayer) continue;
      const info = view.getEntityInfo(id);
      if (!info || info.isCorpse) continue; // not currently in the world
      rows.push({ id, name: e.name || "Player", animal: info.animal });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "— none online —";
      empty.style.cssText = "opacity:.55;font-size:11px;";
      this.list.appendChild(empty);
      return;
    }
    for (const r of rows) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;justify-content:space-between;gap:8px;align-items:center;cursor:pointer;" +
        "padding:5px 8px;border-radius:6px;margin:2px 0;background:rgba(255,255,255,0.04);";
      const nm = document.createElement("span");
      nm.textContent = r.name;
      nm.style.cssText = "font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const sp = document.createElement("span");
      sp.textContent = SPECIES_LABELS[r.animal] ?? "?";
      sp.style.cssText = `opacity:.7;font-size:10px;color:${AMBER};`;
      row.appendChild(nm);
      row.appendChild(sp);
      row.addEventListener("pointerenter", () => (row.style.background = `${AMBER}22`));
      row.addEventListener("pointerleave", () => (row.style.background = "rgba(255,255,255,0.04)"));
      row.addEventListener("click", () => this.onSpectate?.(r.id));
      this.list.appendChild(row);
    }
  }
}
