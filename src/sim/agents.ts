// Structure-of-arrays agent store with swap-remove (dense iteration) and monotonically increasing ids.
import { MAX_AGENTS } from '../config';
import { SNAP_STRIDE, SNAP_ID, SNAP_SPECIES, SNAP_X, SNAP_Z, SNAP_HEADING, SNAP_SIZE, SNAP_STATE, SNAP_ENERGY } from '../shared/messages';
import { AgentState, TRAITS } from '../shared/types';
import type { DeathCause, Genome, SimParams, SpeciesDef } from '../shared/types';
import { capacity } from './genome';

export const CAUSE_NONE = 0;
export const CAUSE_STARVATION = 1;
export const CAUSE_EATEN = 2;
export const CAUSE_OLD_AGE = 3;
export const CAUSE_NAMES: (DeathCause | null)[] = [null, 'starvation', 'eaten', 'oldAge'];

/** Precomputed food-web lookups from the species table. Rebuilt on setSpecies. */
export class Diets {
  count = 0;
  plants = new Uint8Array(4);
  smallerOnly = new Uint8Array(4);
  /** preyMask[s] bit t set = s eats t. threatMask[s] bit t set = t eats s. Self never included. */
  preyMask = new Int32Array(4);
  threatMask = new Int32Array(4);

  update(species: SpeciesDef[]): void {
    this.count = species.length;
    this.preyMask.fill(0);
    this.threatMask.fill(0);
    for (let s = 0; s < species.length; s++) {
      this.plants[s] = species[s].diet.plants ? 1 : 0;
      this.smallerOnly[s] = species[s].diet.smallerPreyOnly ? 1 : 0;
      for (const t of species[s].diet.eats) {
        if (t === s || t < 0 || t >= species.length) continue;
        this.preyMask[s] |= 1 << t;
        this.threatMask[t] |= 1 << s;
      }
    }
  }

  /** Can predator (species ps, size pz) kill prey (species vs, size vz)? Applies diet + size rules. */
  canKill(p: SimParams, ps: number, pz: number, vs: number, vz: number): boolean {
    if (((this.preyMask[ps] >> vs) & 1) === 0) return false;
    if (this.smallerOnly[ps] === 1 && vz >= pz) return false;
    if (p.sizeRule && vz > pz * p.sizeRuleRatio) return false;
    return true;
  }
}

export class Agents {
  count = 0;
  nextId = 1;

  readonly id = new Int32Array(MAX_AGENTS);
  readonly species = new Uint8Array(MAX_AGENTS);
  readonly x = new Float32Array(MAX_AGENTS);
  readonly z = new Float32Array(MAX_AGENTS);
  readonly vx = new Float32Array(MAX_AGENTS);
  readonly vz = new Float32Array(MAX_AGENTS);
  readonly heading = new Float32Array(MAX_AGENTS);
  readonly energy = new Float32Array(MAX_AGENTS);
  readonly age = new Float32Array(MAX_AGENTS);
  readonly state = new Uint8Array(MAX_AGENTS);
  readonly targetId = new Int32Array(MAX_AGENTS); // hunt target (0 = none)
  readonly targetIdx = new Int32Array(MAX_AGENTS); // cached index of targetId (validated on use)
  readonly targetCell = new Int32Array(MAX_AGENTS); // graze target cell (-1 = none)
  readonly attackCd = new Float32Array(MAX_AGENTS);
  readonly reproCd = new Float32Array(MAX_AGENTS);
  readonly fleeTimer = new Float32Array(MAX_AGENTS);
  readonly fleeX = new Float32Array(MAX_AGENTS); // unit flee direction
  readonly fleeZ = new Float32Array(MAX_AGENTS);
  readonly sepX = new Float32Array(MAX_AGENTS); // cached separation push
  readonly sepZ = new Float32Array(MAX_AGENTS);
  readonly wander = new Float32Array(MAX_AGENTS); // wander angle
  readonly generation = new Int32Array(MAX_AGENTS);
  readonly parentId = new Int32Array(MAX_AGENTS);
  readonly kills = new Int32Array(MAX_AGENTS);
  readonly offspring = new Int32Array(MAX_AGENTS);
  readonly dead = new Uint8Array(MAX_AGENTS); // death cause code, 0 = alive

  // Genome, one array per trait (same order as TRAITS).
  readonly size = new Float32Array(MAX_AGENTS);
  readonly speed = new Float32Array(MAX_AGENTS);
  readonly sense = new Float32Array(MAX_AGENTS);
  readonly aggression = new Float32Array(MAX_AGENTS);
  readonly fear = new Float32Array(MAX_AGENTS);
  readonly fertility = new Float32Array(MAX_AGENTS);
  readonly lifespan = new Float32Array(MAX_AGENTS);
  readonly hue = new Float32Array(MAX_AGENTS);
  private readonly traitArrays: Float32Array[] = [
    this.size, this.speed, this.sense, this.aggression, this.fear, this.fertility, this.lifespan, this.hue,
  ];

  private readonly idToIndex = new Map<number, number>();

  /** Appends an agent. Returns its index, or -1 if at capacity. Never reuses ids. */
  add(species: number, x: number, z: number, g: Genome, energy: number, age: number, generation: number, parentId: number, wanderAngle: number): number {
    if (this.count >= MAX_AGENTS) return -1;
    const i = this.count++;
    const id = this.nextId++;
    this.id[i] = id;
    this.idToIndex.set(id, i);
    this.species[i] = species;
    this.x[i] = x;
    this.z[i] = z;
    this.vx[i] = 0;
    this.vz[i] = 0;
    this.heading[i] = wanderAngle;
    this.energy[i] = energy;
    this.age[i] = age;
    this.state[i] = AgentState.WANDER;
    this.targetId[i] = 0;
    this.targetIdx[i] = -1;
    this.targetCell[i] = -1;
    this.attackCd[i] = 0;
    this.reproCd[i] = 0;
    this.fleeTimer[i] = 0;
    this.fleeX[i] = 0;
    this.fleeZ[i] = 0;
    this.sepX[i] = 0;
    this.sepZ[i] = 0;
    this.wander[i] = wanderAngle;
    this.generation[i] = generation;
    this.parentId[i] = parentId;
    this.kills[i] = 0;
    this.offspring[i] = 0;
    this.dead[i] = CAUSE_NONE;
    for (let t = 0; t < TRAITS.length; t++) this.traitArrays[t][i] = g[TRAITS[t]];
    return i;
  }

  /** Swap-remove index i (moves the last agent into i). */
  removeAt(i: number): void {
    const last = this.count - 1;
    this.idToIndex.delete(this.id[i]);
    if (i !== last) {
      this.copy(last, i);
      this.idToIndex.set(this.id[i], i);
    }
    this.count--;
  }

  private copy(from: number, to: number): void {
    this.id[to] = this.id[from];
    this.species[to] = this.species[from];
    this.x[to] = this.x[from];
    this.z[to] = this.z[from];
    this.vx[to] = this.vx[from];
    this.vz[to] = this.vz[from];
    this.heading[to] = this.heading[from];
    this.energy[to] = this.energy[from];
    this.age[to] = this.age[from];
    this.state[to] = this.state[from];
    this.targetId[to] = this.targetId[from];
    this.targetIdx[to] = this.targetIdx[from];
    this.targetCell[to] = this.targetCell[from];
    this.attackCd[to] = this.attackCd[from];
    this.reproCd[to] = this.reproCd[from];
    this.fleeTimer[to] = this.fleeTimer[from];
    this.fleeX[to] = this.fleeX[from];
    this.fleeZ[to] = this.fleeZ[from];
    this.sepX[to] = this.sepX[from];
    this.sepZ[to] = this.sepZ[from];
    this.wander[to] = this.wander[from];
    this.generation[to] = this.generation[from];
    this.parentId[to] = this.parentId[from];
    this.kills[to] = this.kills[from];
    this.offspring[to] = this.offspring[from];
    this.dead[to] = this.dead[from];
    for (let t = 0; t < this.traitArrays.length; t++) this.traitArrays[t][to] = this.traitArrays[t][from];
  }

  /** Index of agent `id`, or -1. `hint` is a cached index checked first (avoids the Map lookup). */
  indexOf(id: number, hint: number): number {
    if (hint >= 0 && hint < this.count && this.id[hint] === id) return hint;
    const i = this.idToIndex.get(id);
    return i === undefined ? -1 : i;
  }

  readGenome(i: number, out: Genome): void {
    for (let t = 0; t < TRAITS.length; t++) out[TRAITS[t]] = this.traitArrays[t][i];
  }

  /** Fills out with SNAP_STRIDE floats per agent. Returns count. */
  writeSnapshot(out: Float32Array, p: SimParams): number {
    const n = Math.min(this.count, Math.floor(out.length / SNAP_STRIDE));
    for (let i = 0; i < n; i++) {
      const o = i * SNAP_STRIDE;
      const cap = capacity(this.size[i], p);
      out[o + SNAP_ID] = this.id[i];
      out[o + SNAP_SPECIES] = this.species[i];
      out[o + SNAP_X] = this.x[i];
      out[o + SNAP_Z] = this.z[i];
      out[o + SNAP_HEADING] = this.heading[i];
      out[o + SNAP_SIZE] = this.size[i];
      out[o + SNAP_STATE] = this.state[i];
      const e = this.energy[i] / cap;
      out[o + SNAP_ENERGY] = e < 0 ? 0 : e > 1 ? 1 : e;
    }
    return n;
  }
}
