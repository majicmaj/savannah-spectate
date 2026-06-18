// Esc settings menu: a DOM overlay (toggle with Escape). Collapsible, grouped
// sections of sliders/checkboxes that mutate the shared `settings`; visual
// changes fire onApply so main can re-apply camera/fog/renderer/HUD visibility.

import { settings, resetSettings } from "../settings.js";

const AMBER = "#f8b95c";

export class EscMenu {
  private root: HTMLDivElement;
  private body: HTMLDivElement; // scrollable settings body
  private refreshers: (() => void)[] = []; // re-sync each control's DOM from settings
  visible = false;
  onApply: (() => void) | null = null;

  constructor() {
    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;" +
      "background:rgba(8,12,16,0.6);backdrop-filter:blur(2px);font:13px/1.5 ui-monospace,Menlo,monospace;color:#eef3f7;";
    // close when clicking the dim backdrop (but not the panel)
    root.addEventListener("pointerdown", (e) => { if (e.target === root) this.toggle(); });

    const panel = document.createElement("div");
    panel.style.cssText =
      "display:flex;flex-direction:column;width:360px;max-width:92vw;max-height:88vh;" +
      `background:rgba(18,23,29,0.97);border:1px solid ${AMBER}55;border-radius:10px;` +
      "box-shadow:0 10px 50px #000b;overflow:hidden;";
    root.appendChild(panel);

    const header = document.createElement("div");
    header.style.cssText =
      `padding:14px 20px 12px;font-weight:bold;font-size:15px;letter-spacing:.5px;color:${AMBER};` +
      "border-bottom:1px solid #ffffff14;";
    header.textContent = "⚙  Settings";
    panel.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "padding:6px 20px 14px;overflow-y:auto;";
    panel.appendChild(body);
    this.body = body;

    // ---- HUD ---------------------------------------------------------------
    const hud = this.section("HUD");
    this.checkbox(hud, "Vitals bar", () => settings.showVitals, (v) => { settings.showVitals = v; this.onApply?.(); });
    this.checkbox(hud, "Debug stats", () => settings.showStats, (v) => { settings.showStats = v; this.onApply?.(); });
    this.checkbox(hud, "Help hint", () => settings.showHelp, (v) => { settings.showHelp = v; this.onApply?.(); });

    // ---- Display -----------------------------------------------------------
    const disp = this.section("Display");
    this.slider(disp, "Render dist", 4, 16, 1, () => settings.chunkRadius,
      (v) => { settings.chunkRadius = v; settings.renderRadiusM = Math.round(v * 31); this.onApply?.(); },
      (v) => `${Math.round(v * 31)} m`);
    this.slider(disp, "FOV", 45, 95, 1, () => settings.fov, (v) => { settings.fov = v; this.onApply?.(); }, (v) => `${v}°`);
    this.checkbox(disp, "Shadows", () => settings.shadows, (v) => { settings.shadows = v; this.onApply?.(); });
    // FPS cap: discrete steps; top of range = uncapped (rAF can't exceed refresh).
    const FPS_STEPS = [30, 60, 90, 120, 144, 240, 0];
    this.slider(disp, "FPS cap", 0, FPS_STEPS.length - 1, 1,
      () => Math.max(0, FPS_STEPS.indexOf(settings.fpsCap)),
      (v) => (settings.fpsCap = FPS_STEPS[v]),
      (v) => (FPS_STEPS[v] === 0 ? "Uncap" : `${FPS_STEPS[v]}`));
    // VSync off → timer-driven free-run (throughput benchmark; more GPU/battery).
    this.checkbox(disp, "VSync", () => settings.vsync, (v) => (settings.vsync = v));

    // ---- Environment -------------------------------------------------------
    const env = this.section("Environment");
    this.checkbox(env, "Live clouds", () => settings.weatherClouds, (v) => (settings.weatherClouds = v));
    this.slider(env, "Clouds", 0, 1, 0.05, () => settings.cloudCover, (v) => (settings.cloudCover = v), (v) => `${Math.round(v * 100)}%`);
    this.checkbox(env, "Rain", () => settings.rain, (v) => (settings.rain = v));

    // ---- Effects -----------------------------------------------------------
    const fx = this.section("Effects");
    this.checkbox(fx, "Run dust", () => settings.dust, (v) => (settings.dust = v));

    // ---- Water -------------------------------------------------------------
    const water = this.section("Water");
    this.slider(water, "Waves", 0, 0.6, 0.02, () => settings.waveHeight,
      (v) => { settings.waveHeight = v; this.onApply?.(); }, (v) => `${v.toFixed(2)}`);
    this.slider(water, "Reflection", 0, 1, 0.05, () => settings.waterReflect,
      (v) => { settings.waterReflect = v; this.onApply?.(); }, (v) => `${Math.round(v * 100)}%`);

    // ---- Audio -------------------------------------------------------------
    const audio = this.section("Audio", true); // collapsed by default
    this.slider(audio, "Master", 0, 1, 0.05, () => settings.masterVol, (v) => (settings.masterVol = v), (v) => `${Math.round(v * 100)}%`);
    this.slider(audio, "Music", 0, 1, 0.05, () => settings.musicVol, (v) => (settings.musicVol = v), (v) => `${Math.round(v * 100)}%`);
    this.slider(audio, "Effects", 0, 1, 0.05, () => settings.sfxVol, (v) => (settings.sfxVol = v), (v) => `${Math.round(v * 100)}%`);
    this.slider(audio, "Ambient", 0, 1, 0.05, () => settings.ambientVol, (v) => (settings.ambientVol = v), (v) => `${Math.round(v * 100)}%`);

    // ---- footer ------------------------------------------------------------
    const reset = document.createElement("button");
    reset.textContent = "Reset to defaults";
    reset.style.cssText =
      `margin-top:16px;width:100%;padding:9px;cursor:pointer;border-radius:7px;border:1px solid ${AMBER}55;` +
      `background:${AMBER}1f;color:${AMBER};font:inherit;font-weight:bold;letter-spacing:.5px;`;
    reset.addEventListener("pointerenter", () => (reset.style.background = `${AMBER}30`));
    reset.addEventListener("pointerleave", () => (reset.style.background = `${AMBER}1f`));
    reset.addEventListener("click", () => { resetSettings(); this.refresh(); this.onApply?.(); });
    body.appendChild(reset);

    const hint = document.createElement("div");
    hint.style.cssText = "margin-top:12px;opacity:.5;font-size:11px;text-align:center;";
    hint.textContent = "Esc close · R random · [ ] cycle · drag/arrows pan · H stats";
    body.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? "flex" : "none";
  }

  /** Re-sync every control's DOM from `settings` (after reset or a hotkey). */
  refresh(): void { for (const r of this.refreshers) r(); }

  // Collapsible section: a clickable header + a body the controls go into.
  private section(title: string, collapsed = false): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "border-top:1px solid #ffffff12;margin-top:6px;";
    const head = document.createElement("div");
    head.style.cssText =
      "display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;" +
      "margin:10px 0 4px;opacity:.75;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;";
    const caret = document.createElement("span");
    caret.style.cssText = "font-size:9px;width:10px;display:inline-block;";
    const lbl = document.createElement("span");
    lbl.textContent = title;
    head.appendChild(caret);
    head.appendChild(lbl);
    const inner = document.createElement("div");
    const apply = () => { inner.style.display = collapsed ? "none" : ""; caret.textContent = collapsed ? "▸" : "▾"; };
    head.addEventListener("click", () => { collapsed = !collapsed; apply(); });
    apply();
    wrap.appendChild(head);
    wrap.appendChild(inner);
    this.body.appendChild(wrap);
    return inner;
  }

  private row(parent: HTMLElement, label: string): HTMLDivElement {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;align-items:center;gap:10px;margin:6px 0;";
    const l = document.createElement("div");
    l.textContent = label;
    l.style.cssText = "width:92px;opacity:.92;";
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
    input.style.cssText = `flex:1;accent-color:${AMBER};`;
    const val = document.createElement("div");
    val.style.cssText = "width:48px;text-align:right;opacity:.85;";
    val.textContent = fmt(get());
    input.addEventListener("input", () => { const v = parseFloat(input.value); set(v); val.textContent = fmt(v); });
    this.refreshers.push(() => { input.value = String(get()); val.textContent = fmt(get()); });
    r.appendChild(input);
    r.appendChild(val);
  }

  private checkbox(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): void {
    const r = this.row(parent, label);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = get();
    input.style.cssText = `accent-color:${AMBER};width:18px;height:18px;cursor:pointer;`;
    input.addEventListener("change", () => set(input.checked));
    this.refreshers.push(() => { input.checked = get(); });
    r.appendChild(input);
  }
}
