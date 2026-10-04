// Centered card shown when a run ends on its own (a species hit the population cap).
import type { RunEnd, SpeciesDef } from '../shared/types';
import { fmtTime } from './hud';

export class Outcome {
  private el: HTMLElement;
  private body: HTMLElement;

  constructor(parent: HTMLElement, onContinue: () => void, onReset: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'card outcome';
    this.el.hidden = true;

    const title = document.createElement('div');
    title.className = 'outcome-title';
    title.textContent = 'Simulation ended';
    this.body = document.createElement('div');
    this.body.className = 'outcome-body';

    const buttons = document.createElement('div');
    buttons.className = 'outcome-buttons';
    const cont = document.createElement('button');
    cont.textContent = 'Continue (cap off)';
    cont.onclick = onContinue;
    const reset = document.createElement('button');
    reset.textContent = 'Reset (R)';
    reset.onclick = onReset;
    buttons.append(cont, reset);

    this.el.append(title, this.body, buttons);
    parent.appendChild(this.el);
  }

  show(end: RunEnd, species: SpeciesDef[]) {
    const sp = species[end.speciesId];
    const name = sp?.name ?? `Species ${end.speciesId + 1}`;
    this.body.innerHTML = '';
    const head = document.createElement('div');
    head.innerHTML = `<b>Over-population:</b> <span style="color:${sp?.color ?? '#fff'}">${escapeHtml(name)}</span> reached ${end.population.toLocaleString()} creatures.`;
    const detail = document.createElement('div');
    detail.className = 'outcome-detail';
    detail.textContent = `It took over the world in ${fmtTime(end.time)} of sim time (${end.tick.toLocaleString()} ticks).`;
    this.body.append(head, detail);
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
