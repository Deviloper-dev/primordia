// Food cellular automaton (spec §5.2). Double-buffered Float32Array, runs every ENV_TICK_EVERY ticks.
import type { SimParams } from '../shared/types';
import type { Rng } from '../shared/rng';
import type { World } from './world';

export class Environment {
  food: Float32Array;
  private next: Float32Array;
  private readonly world: World;
  private readonly size: number;

  constructor(world: World, initialCoverage: number, rng: Rng) {
    this.world = world;
    this.size = world.size;
    const n = world.size * world.size;
    this.food = new Float32Array(n);
    this.next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!world.water[i] && rng.next() < initialCoverage) this.food[i] = 0.3 + 0.7 * rng.next();
    }
  }

  /** One CA step. Reads `food`, writes `next`, swaps. */
  tick(p: SimParams, dtEnv: number, rng: Rng): void {
    const { size } = this;
    const { water, fertility } = this.world;
    const cur = this.food;
    const out = this.next;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = z * size + x;
        if (water[i]) {
          out[i] = 0;
          continue;
        }
        let f = cur[i];
        const fert = fertility[i];
        if (f > 0) {
          f += p.growthRate * fert * f * (1 - f) * dtEnv;
          if (f > 1) f = 1;
        }
        if (cur[i] < 0.05) {
          // GoL-style birth: >= 3 of 8 neighbours lush
          let n = 0;
          if (x > 0) {
            if (cur[i - 1] > 0.5) n++;
            if (z > 0 && cur[i - size - 1] > 0.5) n++;
            if (z < size - 1 && cur[i + size - 1] > 0.5) n++;
          }
          if (x < size - 1) {
            if (cur[i + 1] > 0.5) n++;
            if (z > 0 && cur[i - size + 1] > 0.5) n++;
            if (z < size - 1 && cur[i + size + 1] > 0.5) n++;
          }
          if (z > 0 && cur[i - size] > 0.5) n++;
          if (z < size - 1 && cur[i + size] > 0.5) n++;
          if (n >= 3 && rng.next() < p.sproutChance * fert) f = Math.max(f, p.sproutAmount);
          else if (f === 0 && rng.next() < p.seedChance) f = p.sproutAmount;
        }
        out[i] = f;
      }
    }
    this.next = cur;
    this.food = out;
  }

  /** Corpse fertilization at a continuous position. */
  fertilize(x: number, z: number, amount: number): void {
    const i = (z | 0) * this.size + (x | 0);
    if (this.world.water[i]) return;
    const f = this.food[i] + amount * this.world.fertility[i];
    this.food[i] = f > 1 ? 1 : f;
  }

  /** Total food / land cells, 0..1. */
  biomass(): number {
    let sum = 0;
    const f = this.food;
    for (let i = 0; i < f.length; i++) sum += f[i];
    return sum / Math.max(1, this.world.landCells);
  }

  writeFood(out: Uint8Array): void {
    const f = this.food;
    for (let i = 0; i < f.length; i++) out[i] = (f[i] * 255 + 0.5) | 0;
  }
}
