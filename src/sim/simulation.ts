// Headless simulation (no worker/DOM APIs). One step() = one fixed tick per spec §7.1.
import { ENV_TICK_EVERY, MAX_AGENTS, MAX_SPECIES, SIM, SIM_DT } from '../config';
import type { WorldSetup } from '../shared/messages';
import { Rng } from '../shared/rng';
import type { DeathCause, Genome, SelectedAgentInfo, SimParams, SpeciesDef, StatsPayload } from '../shared/types';
import { Agents, Diets } from './agents';
import { Behavior } from './behavior';
import { Environment } from './environment';
import { capacity, mutate } from './genome';
import { Interactions } from './interactions';
import { SpatialHash } from './spatialHash';
import { Stats } from './stats';
import { World } from './world';

export class Simulation {
  readonly world: World;
  readonly size: number;
  tick = 0;

  private readonly rng: Rng;
  private readonly env: Environment;
  private readonly agents = new Agents();
  private readonly diets = new Diets();
  private readonly hash: SpatialHash;
  private readonly behavior: Behavior;
  private readonly interactions: Interactions;
  private readonly stats = new Stats();
  private params: SimParams;
  private species: SpeciesDef[];
  private readonly capCounts = new Int32Array(MAX_SPECIES);

  private selectedDeath: SelectedAgentInfo | null = null;
  private readonly g1: Genome = { size: 0, speed: 0, sense: 0, aggression: 0, fear: 0, fertility: 0, lifespan: 0, hue: 0 };
  private readonly g2: Genome = { size: 0, speed: 0, sense: 0, aggression: 0, fear: 0, fertility: 0, lifespan: 0, hue: 0 };

  constructor(setup: WorldSetup) {
    this.size = setup.worldSize;
    this.params = { ...setup.params };
    this.species = structuredClone(setup.species);
    this.rng = new Rng(setup.seed);
    this.world = new World(this.size, this.params.waterLevel, this.rng);
    this.env = new Environment(this.world, this.params.initialFoodCoverage, this.rng);
    this.hash = new SpatialHash(this.size, MAX_AGENTS);
    this.diets.update(this.species);
    this.behavior = new Behavior(this.world, this.agents, this.hash, this.diets, this.rng);
    this.interactions = new Interactions(this.world, this.env, this.agents, this.diets, this.rng, this.stats);

    // Initial population: random land positions, mid energy, staggered ages.
    for (let s = 0; s < this.species.length; s++) {
      for (let k = 0; k < this.species[s].initialCount; k++) {
        const cell = this.world.landIndices[this.rng.int(this.world.landCells)];
        // keep clear of cell borders so Float32 rounding can't push us into a neighbouring (water) cell
        const x = (cell % this.size) + 0.02 + 0.96 * this.rng.next();
        const z = Math.floor(cell / this.size) + 0.02 + 0.96 * this.rng.next();
        this.addFromBase(s, x, z, true);
      }
    }
  }

  get time(): number {
    return this.tick * SIM_DT;
  }

  get agentCount(): number {
    return this.agents.count;
  }

  /** First species whose population has reached params.popCap, or -1 (also -1 when the cap is off). */
  speciesOverCap(): number {
    const cap = this.params.popCap;
    if (cap <= 0) return -1;
    const counts = this.capCounts.fill(0);
    const sp = this.agents.species;
    for (let i = 0; i < this.agents.count; i++) counts[sp[i]]++;
    for (let s = 0; s < this.species.length; s++) if (counts[s] >= cap) return s;
    return -1;
  }

  populationOf(speciesId: number): number {
    let n = 0;
    const sp = this.agents.species;
    for (let i = 0; i < this.agents.count; i++) if (sp[i] === speciesId) n++;
    return n;
  }

  get waterHeight(): number {
    return this.world.waterHeight;
  }

  /** Advance one fixed tick. */
  step(): void {
    const p = this.params;
    if (this.tick % ENV_TICK_EVERY === 0) this.env.tick(p, SIM_DT * ENV_TICK_EVERY, this.rng);
    this.hash.build(this.agents.x, this.agents.z, this.agents.count);
    this.behavior.update(this.tick, p, this.env.food);
    this.interactions.update(p);
    this.interactions.removeDead(p);
    this.tick++;
  }

  /** Writes SNAP_STRIDE floats per agent; returns the agent count. */
  writeSnapshot(out: Float32Array): number {
    return this.agents.writeSnapshot(out, this.params);
  }

  /** Food 0..255 per cell (size*size). */
  writeFood(out: Uint8Array): void {
    this.env.writeFood(out);
  }

  getStats(): StatsPayload {
    return this.stats.report(this.agents, this.species.length, this.tick, this.time, this.env.biomass());
  }

  /** Live info, or (once the agent has died) an alive:false record with deathCause. Null if unknown. */
  getSelected(id: number): SelectedAgentInfo | null {
    const a = this.agents;
    const i = a.indexOf(id, -1);
    if (i < 0) return this.selectedDeath && this.selectedDeath.id === id ? this.selectedDeath : null;
    this.interactions.watchId = id; // so the death cause is captured
    this.interactions.onWatchedDeath = (idx, cause) => {
      this.selectedDeath = this.info(idx, false, cause);
    };
    return this.info(i, true);
  }

  /** Spawn `count` agents of a species on land within `radius` of (x, z). Returns how many were placed. */
  spawn(speciesId: number, x: number, z: number, count: number, radius: number): number {
    if (speciesId < 0 || speciesId >= this.species.length) return 0;
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 8; tries++) {
      const ang = this.rng.next() * Math.PI * 2;
      const r = radius * Math.sqrt(this.rng.next());
      const px = Math.fround(x + Math.cos(ang) * r);
      const pz = Math.fround(z + Math.sin(ang) * r);
      if (!this.world.isLand(px, pz)) continue;
      if (this.addFromBase(speciesId, px, pz, false) < 0) break;
      placed++;
    }
    return placed;
  }

  setParams(partial: Partial<SimParams>): void {
    Object.assign(this.params, partial);
  }

  /** Same species count only. Diet edits apply live; baseGenome affects new spawns only. */
  setSpecies(species: SpeciesDef[]): void {
    if (species.length !== this.species.length) return;
    this.species = structuredClone(species);
    this.diets.update(this.species);
  }

  private addFromBase(s: number, x: number, z: number, initial: boolean): number {
    const def = this.species[s];
    mutate(def.baseGenome, this.g2, this.params, this.rng, SIM.spawnMutationScale);
    const cap = capacity(this.g2.size, this.params);
    const energy = cap * this.rng.range(SIM.initialEnergyMin, SIM.initialEnergyMax);
    const age = initial ? this.rng.next() * SIM.initialAgeFraction * this.g2.lifespan : 0;
    const k = this.agents.add(s, x, z, this.g2, energy, age, 0, 0, this.rng.next() * Math.PI * 2);
    // Desync the founders' first births (otherwise the whole cohort reproduces in lockstep).
    if (k >= 0 && initial) this.agents.reproCd[k] = this.rng.next() * this.params.reproCooldown * SIM.initialCooldownSpread;
    return k;
  }

  private info(i: number, alive: boolean, cause?: DeathCause): SelectedAgentInfo {
    const a = this.agents;
    const genome: Genome = { ...this.g1 };
    a.readGenome(i, genome);
    const info: SelectedAgentInfo = {
      id: a.id[i],
      alive,
      species: a.species[i],
      generation: a.generation[i],
      parentId: a.parentId[i],
      age: a.age[i],
      energy: Math.max(0, a.energy[i]),
      capacity: capacity(a.size[i], this.params),
      state: a.state[i] as SelectedAgentInfo['state'],
      genome,
      kills: a.kills[i],
      offspring: a.offspring[i],
      x: a.x[i],
      z: a.z[i],
    };
    if (cause) info.deathCause = cause;
    return info;
  }
}
