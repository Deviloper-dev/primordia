import GUI from 'lil-gui';
import {
  MAX_AGENTS,
  MAX_SPECIES,
  MIN_SPECIES,
  PRESETS,
  SPEED_MAX,
  SPEED_MIN,
  TRAIT_RANGES,
  UI,
  WORLD_SIZE_OPTIONS,
} from '../config';
import { TRAITS } from '../shared/types';
import type { Archetype, PresetId, SimParams, SpeciesDef } from '../shared/types';

export interface AppState {
  seed: number;
  preset: PresetId;
  worldSize: number;
  species: SpeciesDef[];
  params: SimParams;
  paused: boolean;
  speed: number;
  brush: { species: number; count: number; radius: number; mode: boolean };
  view: { shadows: boolean; foodOverlay: boolean; senseRadius: boolean; charts: boolean };
}

export interface PanelCallbacks {
  onPause(paused: boolean): void;
  onStep(): void;
  onSpeed(v: number): void;
  onReset(): void; // reset with current state (seed/preset/species/params)
  onRandomSeed(): void;
  onPreset(id: PresetId): void;
  onParams(p: Partial<SimParams>): void;
  onSpeciesEdit(): void; // species table edited in place (same count)
  onAddSpecies(): void;
  onRemoveSpecies(i: number): void;
  onSpawnRandom(i: number): void;
  onView(): void;
}

const ARCHETYPES: Archetype[] = ['grazer', 'hunter', 'tank', 'swarmer'];

function stepFor(min: number, max: number): number {
  const s = (max - min) / 200;
  return s >= 1 ? 1 : Number(s.toPrecision(1)) || 0.01;
}

export class Panel {
  private gui!: GUI;
  private closedState = new Map<string, boolean>();
  private folders = new Map<string, GUI>();

  constructor(
    private state: AppState,
    private cb: PanelCallbacks,
  ) {
    this.build();
  }

  /** Destroy and recreate everything (used when the species list changes). */
  rebuild() {
    this.build();
  }

  /** Re-read all displayed values from state. */
  refresh() {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private folder(parent: GUI, key: string, title: string, closedByDefault: boolean): GUI {
    const f = parent.addFolder(title);
    this.folders.set(key, f);
    if (this.closedState.get(key) ?? closedByDefault) f.close();
    return f;
  }

  private build() {
    if (this.gui) {
      for (const [k, f] of this.folders) this.closedState.set(k, f._closed);
      this.gui.destroy();
    }
    this.folders.clear();
    const { state: s, cb } = this;
    const gui = (this.gui = new GUI({ title: 'Primordia' }));

    // --- Simulation ---
    const sim = this.folder(gui, 'sim', 'Simulation', false);
    sim.add(s, 'paused').name('paused (Space)').onChange((v: boolean) => cb.onPause(v));
    sim.add({ step: () => cb.onStep() }, 'step').name('step one tick (.)');
    sim.add(s, 'speed', SPEED_MIN, SPEED_MAX, 0.25).name('speed ×').onChange((v: number) => cb.onSpeed(v));
    sim.add(s, 'seed', 0, 999999999, 1).name('seed').onFinishChange(() => cb.onReset());
    sim.add({ random: () => cb.onRandomSeed() }, 'random').name('random seed');
    const presetOptions: Record<string, string> = {};
    for (const p of Object.values(PRESETS)) presetOptions[p.name] = p.id;
    sim.add(s, 'preset', presetOptions).onChange((v: PresetId) => cb.onPreset(v));
    sim.add({ reset: () => cb.onReset() }, 'reset').name('reset (R)');
    sim
      .add(s.params, 'popCap', 0, MAX_AGENTS, 100)
      .name('pop cap / species')
      .onChange((v: number) => cb.onParams({ popCap: v }));

    // --- Species ---
    const sp = this.folder(gui, 'species', 'Species', false);
    s.species.forEach((def, i) => this.speciesFolder(sp, def, i));
    if (s.species.length < MAX_SPECIES) sp.add({ add: () => cb.onAddSpecies() }, 'add').name('+ add species (resets)');

    // --- Environment ---
    const env = this.folder(gui, 'env', 'Environment', true);
    const p = s.params;
    const live = (key: keyof SimParams) => (v: number) => cb.onParams({ [key]: v });
    env.add(p, 'growthRate', 0, 1, 0.01).onChange(live('growthRate'));
    env.add(p, 'sproutChance', 0, 1, 0.01).onChange(live('sproutChance'));
    env.add(p, 'seedChance', 0, 0.001, 0.00001).onChange(live('seedChance'));
    env.add(p, 'plantEnergy', 5, 150, 1).onChange(live('plantEnergy'));
    env.add(s, 'worldSize', WORLD_SIZE_OPTIONS).name('map size (on reset)');
    env.add(p, 'waterLevel', 0, 0.4, 0.01).name('water level (on reset)');

    // --- Evolution ---
    const evo = this.folder(gui, 'evo', 'Evolution', true);
    evo.add(p, 'mutationRate', 0, 0.3, 0.005).onChange(live('mutationRate'));
    evo.add(p, 'bigMutationChance', 0, 0.2, 0.005).onChange(live('bigMutationChance'));
    evo.add(p, 'sizeRule').name('size rule').onChange((v: boolean) => cb.onParams({ sizeRule: v }));
    evo.add(p, 'kBasal', 0, 2, 0.01).onChange(live('kBasal'));
    evo.add(p, 'kMove', 0, 0.1, 0.001).onChange(live('kMove'));
    evo.add(p, 'kSense', 0, 0.2, 0.002).onChange(live('kSense'));

    // --- Brush ---
    const brush = this.folder(gui, 'brush', 'Brush', true);
    const names: Record<string, number> = {};
    s.species.forEach((d, i) => (names[`${i + 1}. ${d.name}`] = i));
    if (s.brush.species >= s.species.length) s.brush.species = 0;
    brush.add(s.brush, 'species', names).name('species');
    brush.add(s.brush, 'count', 1, 100, 1).name('count per click');
    brush.add(s.brush, 'radius', 0.5, 20, 0.5);
    brush.add(s.brush, 'mode').name('brush mode (or Shift+click)');

    // --- View ---
    const view = this.folder(gui, 'view', 'View', true);
    const onView = () => cb.onView();
    view.add(s.view, 'shadows').onChange(onView);
    view.add(s.view, 'foodOverlay').name('food overlay').onChange(onView);
    view.add(s.view, 'senseRadius').name('show sense radius').onChange(onView);
    view.add(s.view, 'charts').name('show charts').onChange(onView);
  }

  private speciesFolder(parent: GUI, def: SpeciesDef, i: number) {
    const { state: s, cb } = this;
    const f = this.folder(parent, `sp${i}`, `${i + 1}. ${def.name}`, i > 0);
    const edit = () => cb.onSpeciesEdit();
    f.add(def, 'name').onFinishChange(() => {
      edit();
      this.rebuild();
    });
    f.addColor(def, 'color').onChange(edit);
    f.add(def, 'archetype', ARCHETYPES).onChange(edit);
    f.add(def, 'initialCount', 0, 1000, 1).name('initial count (on reset)');

    const diet = f.addFolder('Diet (eats)');
    const proxy: Record<string, boolean> = { plants: def.diet.plants, smallerOnly: !!def.diet.smallerPreyOnly };
    diet.add(proxy, 'plants').onChange((v: boolean) => {
      def.diet.plants = v;
      edit();
    });
    s.species.forEach((other, j) => {
      if (j === i) return;
      const key = `eats${j}`;
      proxy[key] = def.diet.eats.includes(j);
      diet.add(proxy, key).name(other.name).onChange((v: boolean) => {
        const set = new Set(def.diet.eats);
        if (v) set.add(j);
        else set.delete(j);
        def.diet.eats = [...set].sort((a, b) => a - b);
        edit();
      });
    });
    diet.add(proxy, 'smallerOnly').name('smaller prey only').onChange((v: boolean) => {
      def.diet.smallerPreyOnly = v;
      edit();
    });

    const genes = f.addFolder('Base genome (new spawns)');
    genes.close();
    for (const t of TRAITS) {
      const [min, max] = TRAIT_RANGES[t];
      genes.add(def.baseGenome, t, min, max, stepFor(min, max)).onChange(edit);
    }

    f.add({ spawn: () => cb.onSpawnRandom(i) }, 'spawn').name(`spawn ${UI.spawnRandomCount} at random`);
    if (s.species.length > MIN_SPECIES) {
      f.add({ remove: () => cb.onRemoveSpecies(i) }, 'remove').name('remove species (resets)');
    }
  }
}
