import { AGENT_STATE_NAMES, TRAITS } from '../shared/types';
import type { Genome, SelectedAgentInfo, SpeciesDef, TraitName } from '../shared/types';

const DEATH_TEXT = { starvation: 'starvation', eaten: 'eaten', oldAge: 'old age' } as const;

function fmt(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}

export class Inspector {
  readonly el: HTMLElement;
  private swatch = document.createElement('span');
  private title = document.createElement('b');
  private idLine = document.createElement('div');
  private ageLine = document.createElement('div');
  private stateLine = document.createElement('div');
  private deathLine = document.createElement('div');
  private energyFill = document.createElement('div');
  private energyText = document.createElement('span');
  private statsLine = document.createElement('div');
  private traitCells = new Map<TraitName, { val: HTMLElement; avg: HTMLElement }>();
  private followBtn = document.createElement('button');
  private species: SpeciesDef[] = [];
  private avgTraits: Genome[] = [];

  constructor(
    parent: HTMLElement,
    private onFollow: () => void,
    private onClose: () => void,
  ) {
    const el = (this.el = document.createElement('div'));
    el.className = 'card inspector';
    el.style.display = 'none';

    const head = document.createElement('div');
    head.className = 'card-head';
    const name = document.createElement('span');
    this.swatch.className = 'swatch';
    name.append(this.swatch, this.title);
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = 'Deselect (Esc)';
    close.onclick = () => this.onClose();
    head.append(name, close);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.append(this.energyFill, this.energyText);

    const table = document.createElement('div');
    table.className = 'traits';
    const header = ['trait', 'this', 'species avg'];
    for (const h of header) {
      const c = document.createElement('span');
      c.className = 'th';
      c.textContent = h;
      table.appendChild(c);
    }
    for (const t of TRAITS) {
      const label = document.createElement('span');
      label.textContent = t;
      const val = document.createElement('span');
      const avg = document.createElement('span');
      avg.className = 'dim';
      table.append(label, val, avg);
      this.traitCells.set(t, { val, avg });
    }

    this.deathLine.className = 'death';
    this.followBtn.onclick = () => this.onFollow();
    const actions = document.createElement('div');
    actions.className = 'actions';
    const desel = document.createElement('button');
    desel.textContent = 'Deselect';
    desel.onclick = () => this.onClose();
    actions.append(this.followBtn, desel);

    el.append(head, this.idLine, this.ageLine, bar, this.stateLine, this.deathLine, table, this.statsLine, actions);
    parent.appendChild(el);
  }

  setSpecies(species: SpeciesDef[]) {
    this.species = species;
  }

  setAverages(avg: Genome[]) {
    this.avgTraits = avg;
  }

  setFollowing(on: boolean) {
    this.followBtn.textContent = on ? 'Following (F)' : 'Follow (F)';
    this.followBtn.classList.toggle('active', on);
  }

  hide() {
    this.el.style.display = 'none';
  }

  show(info: SelectedAgentInfo) {
    const sp = this.species[info.species];
    this.el.style.display = '';
    this.swatch.style.background = sp?.color ?? '#888';
    this.title.textContent = sp?.name ?? `Species ${info.species}`;
    this.idLine.textContent = `#${info.id} · generation ${info.generation}`;
    this.ageLine.textContent = `age ${info.age.toFixed(1)}s / ${info.genome.lifespan.toFixed(0)}s`;
    const ratio = info.capacity > 0 ? Math.max(0, Math.min(1, info.energy / info.capacity)) : 0;
    this.energyFill.style.width = `${ratio * 100}%`;
    this.energyText.textContent = `energy ${info.energy.toFixed(0)} / ${info.capacity.toFixed(0)}`;
    this.stateLine.textContent = info.alive ? `state: ${AGENT_STATE_NAMES[info.state] ?? info.state}` : '';
    this.deathLine.textContent = info.alive ? '' : `Died: ${DEATH_TEXT[info.deathCause ?? 'starvation']}`;
    this.el.classList.toggle('dead', !info.alive);
    const avg = this.avgTraits[info.species];
    for (const t of TRAITS) {
      const c = this.traitCells.get(t)!;
      c.val.textContent = fmt(info.genome[t]);
      c.avg.textContent = avg ? fmt(avg[t]) : '–';
    }
    this.statsLine.textContent = `kills ${info.kills} · offspring ${info.offspring}`;
  }
}
