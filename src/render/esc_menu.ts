// Esc settings menu: a DOM overlay (toggle with Escape) with audio volume
// sliders + visual controls (render distance, FOV, shadows). Mutates the shared
// `settings`; visual changes fire onApply so main can re-apply camera/fog/renderer.

import { settings } from "../settings.js";

export class EscMenu {
  private root: HTMLDivElement;
  visible = false;
  onApply: (() => void) | null = null;

  constructor() {
    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;" +
      "background:rgba(8,12,16,0.55);font:13px/1.5 ui-monospace,Menlo,monospace;color:#eef3f7;";
    const panel = document.createElement("div");
    panel.style.cssText =
      "min-width:320px;background:rgba(20,26,32,0.96);border:1px solid rgba(248,185,92,0.5);" +
      "border-radius:8px;padding:18px 22px;box-shadow:0 8px 40px #000a;";
    panel.innerHTML = `<div style="font-weight:bold;font-size:15px;margin-bottom:12px;letter-spacing:.5px">Settings</div>`;
    root.appendChild(panel);

    const section = (t: string) => {
      const d = document.createElement("div");
      d.textContent = t;
      d.style.cssText = "margin:12px 0 4px;opacity:.7;font-size:11px;text-transform:uppercase;letter-spacing:1px;";
      panel.appendChild(d);
    };

    section("Audio");
    this.slider(panel, "Master", 0, 1, 0.05, () => settings.masterVol, (v) => (settings.masterVol = v), (v) => `${Math.round(v * 100)}%`);
    this.slider(panel, "Music", 0, 1, 0.05, () => settings.musicVol, (v) => (settings.musicVol = v), (v) => `${Math.round(v * 100)}%`);
    this.slider(panel, "Effects", 0, 1, 0.05, () => settings.sfxVol, (v) => (settings.sfxVol = v), (v) => `${Math.round(v * 100)}%`);
    this.slider(panel, "Ambient", 0, 1, 0.05, () => settings.ambientVol, (v) => (settings.ambientVol = v), (v) => `${Math.round(v * 100)}%`);

    section("Graphics");
    this.slider(panel, "Render dist", 4, 16, 1, () => settings.chunkRadius,
      (v) => { settings.chunkRadius = v; settings.renderRadiusM = Math.round(v * 31); this.onApply?.(); },
      (v) => `${Math.round(v * 31)} m`);
    this.slider(panel, "FOV", 45, 95, 1, () => settings.fov, (v) => { settings.fov = v; this.onApply?.(); }, (v) => `${v}`);
    this.slider(panel, "Clouds", 0, 1, 0.05, () => settings.cloudCover, (v) => (settings.cloudCover = v), (v) => `${Math.round(v * 100)}%`);
    this.checkbox(panel, "Shadows", () => settings.shadows, (v) => { settings.shadows = v; this.onApply?.(); });

    const hint = document.createElement("div");
    hint.style.cssText = "margin-top:14px;opacity:.55;font-size:11px;";
    hint.textContent = "Esc close · R random · [ ] cycle · drag/arrows pan · H hide HUD";
    panel.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? "flex" : "none";
  }

  private row(parent: HTMLElement, label: string): HTMLDivElement {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;align-items:center;gap:10px;margin:6px 0;";
    const l = document.createElement("div");
    l.textContent = label;
    l.style.cssText = "width:88px;";
    r.appendChild(l);
    parent.appendChild(r);
    return r;
  }

  private slider(parent: HTMLElement, label: string, min: number, max: number, step: number,
    get: () => number, set: (v: number) => void, fmt: (v: number) => string): void {
    const r = this.row(parent, label);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    input.style.cssText = "flex:1;accent-color:#f8b95c;";
    const val = document.createElement("div");
    val.style.cssText = "width:48px;text-align:right;opacity:.85;";
    val.textContent = fmt(get());
    input.addEventListener("input", () => { const v = parseFloat(input.value); set(v); val.textContent = fmt(v); });
    r.appendChild(input);
    r.appendChild(val);
  }

  private checkbox(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): void {
    const r = this.row(parent, label);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = get();
    input.style.cssText = "accent-color:#f8b95c;width:18px;height:18px;";
    input.addEventListener("change", () => set(input.checked));
    r.appendChild(input);
  }
}
