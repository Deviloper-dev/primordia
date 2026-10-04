// Mutation + energy cost functions (spec §6.2, §6.3).
import { TRAIT_RANGES } from '../config';
import { TRAITS } from '../shared/types';
import type { Genome, SimParams } from '../shared/types';
import type { Rng } from '../shared/rng';

/** Writes a mutated copy of `parent` into `out`. `scale` weakens/strengthens mutation (e.g. for initial spawns). */
export function mutate(parent: Genome, out: Genome, p: SimParams, rng: Rng, scale = 1): void {
  for (let t = 0; t < TRAITS.length; t++) {
    const name = TRAITS[t];
    const [lo, hi] = TRAIT_RANGES[name];
    let sigma = p.mutationRate * scale * (hi - lo);
    if (rng.next() < p.bigMutationChance) sigma *= p.bigMutationMultiplier;
    const v = parent[name] + rng.gaussian(0, sigma);
    out[name] = v < lo ? lo : v > hi ? hi : v;
  }
}

export function capacity(size: number, p: SimParams): number {
  return p.capacityPerSize2 * size * size;
}

export function basalCost(size: number, p: SimParams): number {
  return p.kBasal * size * size * size;
}

export function moveCost(size: number, v: number, p: SimParams): number {
  return p.kMove * size * size * size * v * v;
}

export function senseCost(sense: number, p: SimParams): number {
  return p.kSense * sense;
}
