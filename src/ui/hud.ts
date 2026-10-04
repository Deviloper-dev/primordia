import { UI } from '../config';
import type { SpeciesDef, StatsPayload } from '../shared/types';

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export class Hud {
  readonly el: HTMLElement;
  private toasts: HTMLElement;
  private text: HTMLElement;
  private prevPops: number[] = [];
  private species: SpeciesDef[] = [];
  private lastUpdate = 0;
  tick = 0;
  time = 0;
  population = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.text = document.createElement('div');
    this.text.className = 'card hud-main';
    this.toasts = document.createElement('div');
    this.toasts.className = 'toasts';
    this.el.append(this.text, this.toasts);
    parent.appendChild(this.el);
  }

  setSpecies(species: SpeciesDef[]) {
    this.species = species;
    this.prevPops = [];
  }

  reset() {
    this.prevPops = [];
    this.tick = this.time = this.population = 0;
  }

  onStats(s: StatsPayload) {
    this.tick = s.tick;
    this.time = s.time;
    this.population = s.populations.reduce((a, b) => a + b, 0);
    s.populations.forEach((p, i) => {
      if ((this.prevPops[i] ?? 0) > 0 && p === 0) {
        this.toast(`${this.species[i]?.name ?? `Species ${i + 1}`} went extinct at ${fmtTime(s.time)}`);
      }
    });
    this.prevPops = s.populations.slice();
  }

  private toast(msg: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), UI.toastSeconds * 1000);
  }

  /** Called every frame; only touches the DOM a few times per second. */
  update(nowMs: number, fps: number, seed: number) {
    if (nowMs - this.lastUpdate < UI.hudUpdateMs) return;
    this.lastUpdate = nowMs;
    this.text.textContent = `tick ${this.tick} · ${fmtTime(this.time)} · ${fps.toFixed(0)} fps · pop ${this.population} · seed ${seed}`;
  }
}
