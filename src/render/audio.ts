// Audio: WebAudio via THREE.AudioListener (on the camera). Looping day/night
// music + ambient that swap with the cycle, periodic wind gusts, and one-shot
// spatial SFX (animal calls, hit impacts, eating) triggered from snapshot events
// in world_view. Manual distance attenuation (cheap) instead of per-sound
// PositionalAudio. Buffers are lazy-loaded + cached. Bus gains from `settings`.
// Browsers block audio until a user gesture → start() must run on first input.

import * as THREE from "three";
import { settings } from "../settings.js";

const SPECIES = ["lion", "elephant", "gazelle", "crocodile", "wildebeest", "cheetah", "vulture", "hyena"];
// last_call_type 0..6 → vox kind (net.gd CALL_* mapping)
const CALL_KIND = ["friendly", "alarm", "aggressive", "alarm", "friendly", "friendly", "friendly"];
// per-species call propagation [refDist, maxDist] (m)
const CALL_REF = [60, 70, 25, 35, 30, 50, 45, 55];
const CALL_MAX = [700, 700, 150, 300, 220, 600, 500, 650];

const db2lin = (db: number) => Math.pow(10, db / 20);
const rand = (n: number) => Math.floor(Math.random() * n);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// vulture (6) / hyena (7) vox live in sounds_new with bespoke names
const VULTURE: Record<string, string> = { friendly: "vulture_long_whistle", alarm: "vulture_longer_whistle", aggressive: "vulture_screech", idle: "vulture_squeek", hurt: "vulture_lament" };
const HYENA: Record<string, string> = { friendly: "huhuhuHUUUUUU", alarm: "laugh_8_spikes", aggressive: "yell-growl01", idle: "laugh_2_spikes_short", hurt: "hyena_yelp_1" };

function voxPath(animal: number, callType: number): string {
  const kind = CALL_KIND[callType] ?? "idle";
  if (animal === 6) return `/sounds/sounds_new/vulture/${VULTURE[kind] ?? VULTURE.idle}.ogg`;
  if (animal === 7) return `/sounds/sounds_new/hyena/${HYENA[kind] ?? HYENA.idle}.ogg`;
  return `/assets/audio/vox/${SPECIES[animal] ?? "lion"}/${kind}.ogg`;
}

export class AudioSys {
  readonly listener = new THREE.AudioListener();
  private loader = new THREE.AudioLoader();
  private buffers = new Map<string, AudioBuffer | "loading">();
  private music?: THREE.Audio;
  private ambient?: THREE.Audio;
  private sfxPool: THREE.Audio[] = [];
  private started = false;
  private isNight = false;
  private windNext = 10;
  private camPos = new THREE.Vector3();

  attach(camera: THREE.Camera): void {
    camera.add(this.listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.listener.context.resume();
    this.music = new THREE.Audio(this.listener); this.music.setLoop(true);
    this.ambient = new THREE.Audio(this.listener); this.ambient.setLoop(true);
    this.applyDayNight(this.isNight, true);
  }

  private getBuffer(url: string, cb: (b: AudioBuffer) => void): void {
    const b = this.buffers.get(url);
    if (b === "loading") return;
    if (b) { cb(b); return; }
    this.buffers.set(url, "loading");
    this.loader.load(url, (buf) => { this.buffers.set(url, buf); cb(buf); }, undefined, () => this.buffers.delete(url));
  }

  private setLoop(audio: THREE.Audio, url: string, vol: number): void {
    this.getBuffer(url, (buf) => {
      if (audio.buffer === buf) { audio.setVolume(vol); return; }
      if (audio.isPlaying) audio.stop();
      audio.setBuffer(buf);
      audio.setVolume(vol);
      audio.play();
    });
  }

  private masterMul() { return settings.masterVol; }
  private musicGain() { return this.masterMul() * settings.musicVol * db2lin(-10); }
  private ambientGain() { return this.masterMul() * settings.ambientVol * db2lin(-4); }
  private sfxGain() { return this.masterMul() * settings.sfxVol; }

  applyDayNight(night: boolean, force = false): void {
    this.isNight = night;
    if (!this.started || !this.music || !this.ambient) return;
    this.setLoop(this.music, night ? "/sounds/music_background_theme_NIGHT.ogg" : "/assets/audio/music/theme.ogg", this.musicGain());
    this.setLoop(this.ambient, night ? "/sounds/sound_NIGHT_CRICKETS.ogg" : "/assets/audio/ambient/birds_wind.ogg", this.ambientGain());
    void force;
  }

  private freeSfx(): THREE.Audio {
    for (const a of this.sfxPool) if (!a.isPlaying) return a;
    const a = new THREE.Audio(this.listener);
    if (this.sfxPool.length < 28) this.sfxPool.push(a);
    return a;
  }

  private playSpatial(url: string, pos: THREE.Vector3, baseDb: number, refDist: number, maxDist: number, busGain: number): void {
    if (!this.started) return;
    const dist = pos.distanceTo(this.camPos);
    if (dist > maxDist) return;
    const atten = dist <= refDist ? 1 : Math.max(0, 1 - (dist - refDist) / (maxDist - refDist));
    const gain = db2lin(baseDb) * atten * busGain;
    if (gain < 0.003) return;
    this.getBuffer(url, (buf) => {
      const a = this.freeSfx();
      if (a.isPlaying) a.stop();
      a.setBuffer(buf);
      a.setVolume(gain);
      a.setPlaybackRate(0.95 + Math.random() * 0.1);
      a.play();
    });
  }

  playCall(animal: number, callType: number, pos: THREE.Vector3): void {
    this.playSpatial(voxPath(animal, callType), pos, -2, CALL_REF[animal] ?? 40, Math.max(200, CALL_MAX[animal] ?? 300), this.sfxGain());
  }
  playHit(pos: THREE.Vector3, weight: number): void {
    this.playSpatial(`/assets/audio/fx/hit/hit_0${1 + rand(3)}.ogg`, pos, lerp(-6, 1, weight), 16, 80, this.sfxGain());
  }
  playEat(pos: THREE.Vector3): void {
    this.playSpatial(`/assets/audio/fx/eat/eat_0${1 + rand(4)}.ogg`, pos, -8, 16, 80, this.sfxGain());
  }
  private playWind(): void {
    this.getBuffer("/sounds/sound_wind.ogg", (buf) => {
      const a = this.freeSfx();
      if (a.isPlaying) a.stop();
      a.setBuffer(buf);
      a.setVolume(this.masterMul() * settings.ambientVol * db2lin(-16));
      a.play();
    });
  }

  update(dt: number, night: boolean, camPos: THREE.Vector3): void {
    if (!this.started) return;
    this.camPos.copy(camPos);
    if (night !== this.isNight) this.applyDayNight(night);
    if (this.music?.buffer) this.music.setVolume(this.musicGain());
    if (this.ambient?.buffer) this.ambient.setVolume(this.ambientGain());
    this.windNext -= dt;
    if (this.windNext <= 0) { this.windNext = 60 + Math.random() * 120; this.playWind(); }
  }
}
