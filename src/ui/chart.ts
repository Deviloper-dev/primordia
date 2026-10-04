// Custom canvas line charts: population (+ plant biomass) and average trait per species.
import { UI } from '../config';
import { CHART_TRAITS } from '../shared/types';
import type { ChartTrait, SpeciesDef, StatsPayload } from '../shared/types';

const PAD_L = 38;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 16;

interface Point {
  time: number;
  pops: number[];
  traits: number[][]; // [species][CHART_TRAITS index]
  biomass: number;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtNum(v: number): string {
  if (v >= 100) return Math.round(v).toString();
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export class Charts {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private popCanvas: HTMLCanvasElement;
  private traitCanvas: HTMLCanvasElement;
  private select: HTMLSelectElement;
  private points: Point[] = [];
  private species: SpeciesDef[] = [];
  private trait: ChartTrait = CHART_TRAITS[0];
  private collapsed = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'card charts';
    const head = document.createElement('div');
    head.className = 'card-head';
    const title = document.createElement('span');
    title.textContent = 'Charts';
    const toggle = document.createElement('button');
    toggle.textContent = '–';
    toggle.title = 'Collapse';
    toggle.onclick = () => {
      this.collapsed = !this.collapsed;
      this.body.style.display = this.collapsed ? 'none' : '';
      toggle.textContent = this.collapsed ? '+' : '–';
      this.draw();
    };
    head.append(title, toggle);

    this.body = document.createElement('div');
    this.popCanvas = this.makeCanvas();
    this.traitCanvas = this.makeCanvas();
    const row = document.createElement('div');
    row.className = 'chart-row';
    const label = document.createElement('span');
    label.textContent = 'Average trait:';
    this.select = document.createElement('select');
    for (const t of CHART_TRAITS) this.select.add(new Option(t, t));
    this.select.onchange = () => {
      this.trait = this.select.value as ChartTrait;
      this.draw();
    };
    row.append(label, this.select);
    this.body.append(this.popCanvas, row, this.traitCanvas);
    this.el.append(head, this.body);
    parent.appendChild(this.el);
  }

  private makeCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = UI.chartWidth * dpr;
    c.height = UI.chartHeight * dpr;
    c.style.width = `${UI.chartWidth}px`;
    c.style.height = `${UI.chartHeight}px`;
    return c;
  }

  setVisible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  setSpecies(species: SpeciesDef[]) {
    this.species = species;
    this.draw();
  }

  clear() {
    this.points.length = 0;
    this.draw();
  }

  push(s: StatsPayload) {
    this.points.push({
      time: s.time,
      pops: s.populations.slice(),
      traits: s.avgTraits.map((g) => CHART_TRAITS.map((t) => g[t])),
      biomass: s.plantBiomass,
    });
    const min = s.time - UI.chartWindowSeconds;
    let drop = 0;
    while (drop < this.points.length - 1 && this.points[drop].time < min) drop++;
    if (drop > 0) this.points.splice(0, drop);
    this.draw();
  }

  private draw() {
    if (this.collapsed) return;
    const pts = this.points;
    const tEnd = pts.length ? pts[pts.length - 1].time : 0;
    const t0 = Math.max(0, tEnd - UI.chartWindowSeconds);
    const t1 = Math.max(tEnd, t0 + UI.chartMinSpanSeconds);

    // chart 1: populations + biomass
    let maxPop = 1;
    let maxBio = 0.001;
    for (const p of pts) {
      for (const v of p.pops) if (v > maxPop) maxPop = v;
      if (p.biomass > maxBio) maxBio = p.biomass;
    }
    const ctx1 = this.setup(this.popCanvas);
    this.frame(ctx1, t0, t1, 0, maxPop, 'population');
    this.species.forEach((sp, i) => {
      this.line(ctx1, pts, t0, t1, 0, maxPop, (p) => p.pops[i], sp.color, false);
    });
    this.line(ctx1, pts, t0, t1, 0, maxBio, (p) => p.biomass, '#9fe870', true);
    this.legend(ctx1, true);

    // chart 2: average trait
    const ti = CHART_TRAITS.indexOf(this.trait);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      p.traits.forEach((tr, i) => {
        if (p.pops[i] > 0) {
          if (tr[ti] < lo) lo = tr[ti];
          if (tr[ti] > hi) hi = tr[ti];
        }
      });
    }
    if (!isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (hi - lo < 1e-6) {
      lo -= 0.5;
      hi += 0.5;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const ctx2 = this.setup(this.traitCanvas);
    this.frame(ctx2, t0, t1, lo, hi, this.trait);
    this.species.forEach((sp, i) => {
      this.line(ctx2, pts, t0, t1, lo, hi, (p) => (p.pops[i] > 0 ? p.traits[i]?.[ti] : undefined), sp.color, false);
    });
    this.legend(ctx2, false);
  }

  private setup(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, UI.chartWidth, UI.chartHeight);
    return ctx;
  }

  private frame(ctx: CanvasRenderingContext2D, t0: number, t1: number, lo: number, hi: number, title: string) {
    const w = UI.chartWidth;
    const h = UI.chartHeight;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, w - PAD_L - PAD_R, h - PAD_T - PAD_B);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fmtNum(hi), PAD_L - 4, PAD_T + 8);
    ctx.fillText(fmtNum(lo), PAD_L - 4, h - PAD_B);
    ctx.textAlign = 'left';
    ctx.fillText(fmtTime(t0), PAD_L, h - 3);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(t1), w - PAD_R, h - 3);
    ctx.textAlign = 'left';
    ctx.fillText(title, PAD_L + 4, PAD_T - 4);
  }

  private line(
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    t0: number,
    t1: number,
    lo: number,
    hi: number,
    get: (p: Point) => number | undefined,
    color: string,
    dashed: boolean,
  ) {
    const x0 = PAD_L;
    const y0 = PAD_T;
    const pw = UI.chartWidth - PAD_L - PAD_R;
    const ph = UI.chartHeight - PAD_T - PAD_B;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      const v = get(p);
      if (v === undefined || p.time < t0) {
        pen = false;
        continue;
      }
      const x = x0 + ((p.time - t0) / (t1 - t0)) * pw;
      const y = y0 + ph - ((v - lo) / (hi - lo)) * ph;
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private legend(ctx: CanvasRenderingContext2D, withPlants: boolean) {
    let x = UI.chartWidth - PAD_R;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    const items = this.species.map((s) => ({ name: s.name, color: s.color }));
    if (withPlants) items.push({ name: 'plants', color: '#9fe870' });
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      ctx.fillStyle = it.color;
      const w = ctx.measureText(it.name).width;
      ctx.fillText(it.name, x, PAD_T - 4);
      x -= w + 8;
    }
  }
}
