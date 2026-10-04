// Eating, combat, reproduction, energy/age, death (spec §7.3).
import { MAX_AGENTS, SIM, SIM_DT } from '../config';
import { AgentState } from '../shared/types';
import type { Genome, SimParams } from '../shared/types';
import type { Rng } from '../shared/rng';
import { Agents, CAUSE_EATEN, CAUSE_NAMES, CAUSE_OLD_AGE, CAUSE_STARVATION } from './agents';
import type { Diets } from './agents';
import type { Environment } from './environment';
import { basalCost, capacity, moveCost, mutate, senseCost } from './genome';
import type { Stats } from './stats';
import type { World } from './world';
import type { DeathCause } from '../shared/types';

export class Interactions {
  /** Called (before removal) when the agent with `watchId` dies. */
  watchId = -1;
  onWatchedDeath: ((index: number, cause: DeathCause) => void) | null = null;

  private readonly parentGenome: Genome = { size: 0, speed: 0, sense: 0, aggression: 0, fear: 0, fertility: 0, lifespan: 0, hue: 0 };
  private readonly childGenome: Genome = { size: 0, speed: 0, sense: 0, aggression: 0, fear: 0, fertility: 0, lifespan: 0, hue: 0 };

  constructor(
    private readonly world: World,
    private readonly env: Environment,
    private readonly a: Agents,
    private readonly diets: Diets,
    private readonly rng: Rng,
    private readonly stats: Stats,
  ) {}

  update(p: SimParams): void {
    const a = this.a;
    const food = this.env.food;
    const gsize = this.world.size;
    const n = a.count; // newborns appended during the loop are not processed this tick
    for (let i = 0; i < n; i++) {
      if (a.dead[i] !== 0) continue;
      const sp = a.species[i];
      const size = a.size[i];

      // Timers
      a.age[i] += SIM_DT;
      if (a.attackCd[i] > 0) a.attackCd[i] -= SIM_DT;
      if (a.reproCd[i] > 0) a.reproCd[i] -= SIM_DT;
      if (a.fleeTimer[i] > 0) {
        a.fleeTimer[i] -= SIM_DT;
        if (a.fleeTimer[i] <= 0) a.state[i] = AgentState.WANDER;
      }

      const cap = capacity(size, p);
      const st = a.state[i];

      // Eat plants
      if (this.diets.plants[sp] === 1 && st !== AgentState.FLEE && st !== AgentState.HUNT && st !== AgentState.FIGHT) {
        const cell = ((a.z[i] | 0) * gsize) + (a.x[i] | 0);
        // Grazing leaves a residual (roots), so patches regrow instead of being wiped to 0 (which the CA can't undo).
        const f = food[cell] - SIM.plantResidual;
        if (f > 0) {
          let bite = p.biteRate * size * SIM_DT;
          const room = (cap - a.energy[i]) / p.plantEnergy;
          if (bite > f) bite = f;
          if (bite > room) bite = room;
          if (bite > 0) {
            food[cell] = f - bite;
            a.energy[i] += bite * p.plantEnergy;
          }
        }
      }

      // Combat
      if ((st === AgentState.HUNT || st === AgentState.FIGHT) && a.attackCd[i] <= 0 && a.targetId[i] !== 0) {
        const j = a.indexOf(a.targetId[i], a.targetIdx[i]);
        if (j < 0 || a.dead[j] !== 0 || !this.diets.canKill(p, sp, size, a.species[j], a.size[j])) {
          a.targetId[i] = 0;
          a.state[i] = AgentState.WANDER;
        } else {
          a.targetIdx[i] = j;
          const dx = a.x[j] - a.x[i];
          const dz = a.z[j] - a.z[i];
          const reach = SIM.contactFactor * (size + a.size[j]);
          if (dx * dx + dz * dz <= reach * reach) this.fight(i, j, dx, dz, cap, p);
        }
      }

      // Energy & age
      const v2 = a.vx[i] * a.vx[i] + a.vz[i] * a.vz[i];
      a.energy[i] -= (basalCost(size, p) + moveCost(size, Math.sqrt(v2), p) + senseCost(a.sense[i], p)) * SIM_DT;
      if (a.dead[i] === 0) {
        if (a.energy[i] <= 0) a.dead[i] = CAUSE_STARVATION;
        else if (a.age[i] > a.lifespan[i]) a.dead[i] = CAUSE_OLD_AGE;
      }

      // Reproduction
      if (a.dead[i] === 0 && a.state[i] !== AgentState.FLEE && a.reproCd[i] <= 0 && a.energy[i] > a.fertility[i] * cap) {
        this.reproduce(i, p);
      }
    }
  }

  private fight(i: number, j: number, dx: number, dz: number, cap: number, p: SimParams): void {
    const a = this.a;
    const attack = a.size[i] * (0.5 + a.aggression[i]);
    const defense = a.size[j] * (0.5 + 0.5 * (1 - a.fear[j]));
    a.attackCd[i] = p.attackCooldown;
    a.state[i] = AgentState.FIGHT;
    if (this.rng.next() < attack / (attack + defense)) {
      a.dead[j] = CAUSE_EATEN;
      a.kills[i]++;
      const gain = p.meatEnergy * a.size[j] * a.size[j] * p.meatEfficiency;
      a.energy[i] = Math.min(cap, a.energy[i] + gain);
      a.targetId[i] = 0;
    } else {
      a.energy[i] -= p.fightDamage * a.size[j];
      a.state[i] = AgentState.FLEE;
      a.fleeTimer[i] = p.fleeAfterLoss;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      a.fleeX[i] = -dx / d;
      a.fleeZ[i] = -dz / d;
      a.targetId[i] = 0;
    }
  }

  private reproduce(i: number, p: SimParams): void {
    const a = this.a;
    if (a.count >= MAX_AGENTS) return; // silently fails
    let childEnergy = p.offspringEnergyFraction * a.energy[i];
    if (a.energy[i] - childEnergy - p.reproCost <= 0) return;

    // Find an adjacent land spot.
    let cx = a.x[i];
    let cz = a.z[i];
    for (let t = 0; t < SIM.childSpawnTries; t++) {
      const ang = this.rng.next() * Math.PI * 2;
      const r = SIM.childSpawnRadius * (0.3 + 0.7 * this.rng.next());
      const px = Math.fround(a.x[i] + Math.cos(ang) * r);
      const pz = Math.fround(a.z[i] + Math.sin(ang) * r);
      if (this.world.isLand(px, pz)) {
        cx = px;
        cz = pz;
        break;
      }
    }

    a.readGenome(i, this.parentGenome);
    mutate(this.parentGenome, this.childGenome, p, this.rng);
    const childCap = capacity(this.childGenome.size, p);
    if (childEnergy > childCap) childEnergy = childCap;
    const k = a.add(a.species[i], cx, cz, this.childGenome, childEnergy, 0, a.generation[i] + 1, a.id[i], this.rng.next() * Math.PI * 2);
    if (k < 0) return;
    a.reproCd[k] = p.reproCooldown;
    a.energy[i] -= childEnergy + p.reproCost;
    a.reproCd[i] = p.reproCooldown;
    a.offspring[i]++;
    this.stats.births[a.species[i]]++;
  }

  /** Removes all agents flagged dead; corpses fertilize the food grid. */
  removeDead(p: SimParams): void {
    const a = this.a;
    for (let i = a.count - 1; i >= 0; i--) {
      const cause = a.dead[i];
      if (cause === 0) continue;
      this.stats.deaths[a.species[i]]++;
      this.env.fertilize(a.x[i], a.z[i], p.corpseNutrient * a.size[i]);
      if (a.id[i] === this.watchId && this.onWatchedDeath) this.onWatchedDeath(i, CAUSE_NAMES[cause] as DeathCause);
      a.removeAt(i);
    }
  }
}
