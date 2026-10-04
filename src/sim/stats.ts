// Population / trait aggregation for the StatsPayload.
import { MAX_SPECIES } from '../config';
import { TRAITS } from '../shared/types';
import type { Genome, StatsPayload } from '../shared/types';
import type { Agents } from './agents';

function zeroGenome(): Genome {
  return { size: 0, speed: 0, sense: 0, aggression: 0, fear: 0, fertility: 0, lifespan: 0, hue: 0 };
}

export class Stats {
  readonly births = new Int32Array(MAX_SPECIES);
  readonly deaths = new Int32Array(MAX_SPECIES);

  /** Builds a report and resets the births/deaths counters. */
  report(a: Agents, nSpecies: number, tick: number, time: number, plantBiomass: number): StatsPayload {
    const populations: number[] = new Array(nSpecies).fill(0);
    const avgTraits: Genome[] = [];
    for (let s = 0; s < nSpecies; s++) avgTraits.push(zeroGenome());
    const arrays = [a.size, a.speed, a.sense, a.aggression, a.fear, a.fertility, a.lifespan, a.hue];
    for (let i = 0; i < a.count; i++) {
      const s = a.species[i];
      populations[s]++;
      const g = avgTraits[s];
      for (let t = 0; t < TRAITS.length; t++) g[TRAITS[t]] += arrays[t][i];
    }
    for (let s = 0; s < nSpecies; s++) {
      if (populations[s] === 0) continue;
      for (let t = 0; t < TRAITS.length; t++) avgTraits[s][TRAITS[t]] /= populations[s];
    }
    const births = Array.from(this.births.subarray(0, nSpecies));
    const deaths = Array.from(this.deaths.subarray(0, nSpecies));
    this.births.fill(0);
    this.deaths.fill(0);
    return { tick, time, populations, avgTraits, births, deaths, plantBiomass };
  }
}
