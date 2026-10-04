// Seeded PRNG (mulberry32) + helpers. All worker randomness must go through this.

export class Rng {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Gaussian via Box–Muller (caches the second sample). */
  gaussian(mean = 0, sigma = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mean + sigma * v;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mean + sigma * mag * Math.cos(2 * Math.PI * v);
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1e9);
}
