// Headless balancing harness: npm run tune -- --seeds 1,2,3 --minutes 12 --preset classic --every 30
import { SIM, DEFAULT_PARAMS, DEFAULT_WORLD_SIZE, PRESETS, SIM_DT, clonePresetSpecies } from '../src/config';
import { Simulation } from '../src/sim/simulation';
import type { PresetId, StatsPayload } from '../src/shared/types';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const seeds = (args.get('seeds') ?? '1,2,3,4,5').split(',').map(Number);
const minutes = Number(args.get('minutes') ?? 12);
const preset = (args.get('preset') ?? 'classic') as PresetId;
const every = Number(args.get('every') ?? 30);
// Optional exploration overrides (not committed to config): --set kBasal=1,reproCooldown=8
const overrides: Record<string, number> = {};
for (const kv of (args.get('set') ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); overrides[k] = Number(v); }
if (!PRESETS[preset]) throw new Error(`unknown preset ${preset}`);

const TR = ['size', 'speed', 'fear'] as const;
const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);

function smooth(xs: number[], w: number): number[] {
  return xs.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(xs.length - 1, i + w); k++) { s += xs[k]; n++; }
    return s / n;
  });
}
/** Local maxima whose prominence exceeds 15% of the series mean (ignores jitter). */
function peaks(xs: number[]): number {
  if (xs.length < 5) return 0;
  const sm = smooth(xs, 2);
  const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
  let count = 0, lastVal = sm[0], dir = 0, lastExt = sm[0];
  for (let i = 1; i < sm.length; i++) {
    const d = sm[i] - lastVal;
    if (Math.abs(d) < 1e-9) continue;
    const nd = d > 0 ? 1 : -1;
    if (nd !== dir) {
      if (dir === 1 && lastVal - lastExt > 0.15 * mean) count++;
      if (dir !== 0 || nd === -1) lastExt = lastVal;
      dir = nd;
      if (nd === 1) lastExt = lastVal;
    }
    lastVal = sm[i];
  }
  return count;
}

// Genome overrides: --gen 1.sense=14,1.size=1 (speciesIndex.trait=value) and --count 1=40
const genOv = (args.get('gen') ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); const [si, tr] = k.split('.'); return { si: Number(si), tr, v: Number(v) }; });
const countOv = (args.get('count') ?? '').split(',').filter(Boolean).map((kv) => kv.split('=').map(Number));

for (const kv of (args.get('sim') ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); (SIM as Record<string, unknown>)[k] = Number(v); } // exploration: override SIM.* constants

let allAlive10 = 0;
for (const seed of seeds) {
  const species = clonePresetSpecies(preset);
  for (const g of genOv) (species[g.si].baseGenome as unknown as Record<string, number>)[g.tr] = g.v;
  for (const [si, c] of countOv) species[si].initialCount = c;
  if (args.get('nohunt')) for (const si of args.get('nohunt')!.split(',').map(Number)) species[si].diet.eats = [];
  const ns = species.length;
  const sim = new Simulation({ seed, preset, worldSize: DEFAULT_WORLD_SIZE, species, params: { ...DEFAULT_PARAMS, ...overrides } });
  const t0 = Date.now();
  const series: number[][] = species.map(() => []);
  const times: number[] = [];
  const extinct: (number | null)[] = species.map(() => null);
  let first: StatsPayload | null = null, last: StatsPayload | null = null;
  const lastTraits: (StatsPayload['avgTraits'][number] | null)[] = species.map(() => null);
  const total = Math.round((minutes * 60) / SIM_DT);
  const sampleEvery = Math.round(5 / SIM_DT); // 5 s series for peaks/min/max
  const printEvery = Math.round(every / SIM_DT);
  console.log(`== seed ${seed} ${preset} (${species.map((s) => s.name).join('/')})`);
  let alive10 = true;
  let overCap = -1, overCapTime = 0;
  for (let t = 1; t <= total; t++) {
    sim.step();
    if (t % 20 === 0 && sim.speciesOverCap() >= 0) {
      overCap = sim.speciesOverCap();
      overCapTime = sim.time;
      alive10 = false;
      console.log(`!! OVERPOP: ${species[overCap].name} reached popCap at t${Math.round(overCapTime)}s (pop ${sim.populationOf(overCap)}) -> run ended, counts as FAIL`);
      break;
    }
    if (t % sampleEvery !== 0 && t % printEvery !== 0) continue;
    const st = sim.getStats();
    if (!first) first = st;
    last = st;
    st.populations.forEach((p, s) => { if (p > 0) lastTraits[s] = st.avgTraits[s]; });
    if (t % sampleEvery === 0) {
      times.push(st.time);
      st.populations.forEach((p, s) => {
        series[s].push(p);
        if (p === 0 && extinct[s] === null) extinct[s] = st.time;
      });
    }
    if (t % printEvery === 0) {
      const g = st.avgTraits[0];
      console.log(`t${String(Math.round(st.time)).padStart(4)} pop[${st.populations.join(',')}] food${f2(st.plantBiomass)} sp0 spd${f1(g.speed)} fear${f2(g.fear)} sz${f2(g.size)}`);
    }
    if (st.time >= 600 && st.populations.some((p) => p === 0)) alive10 = false;
    if (st.populations.every((p) => p === 0)) break;
  }
  // survival at 10 min (or end of run if shorter)
  if (last && last.populations.every((p) => p > 0) && alive10 && minutes >= 10) allAlive10++;
  console.log(`-- seed ${seed} (${((Date.now() - t0) / 1000).toFixed(1)}s wall)`);
  for (let s = 0; s < ns; s++) {
    const post = series[s].filter((_, i) => times[i] >= 60);
    const mn = post.length ? Math.min(...post) : 0, mx = post.length ? Math.max(...post) : 0;
    const drift = TR.map((k) => `${k} ${f2(first!.avgTraits[s][k])}->${f2((lastTraits[s] ?? last!.avgTraits[s])[k])}`).join(' ');
    console.log(`  ${species[s].name}: ${extinct[s] === null ? 'alive' : 'extinct@' + Math.round(extinct[s]!) + 's'} min/max>60s ${mn}/${mx} peaks ${peaks(post)} | ${drift}`);
  }
}
console.log(`SUMMARY ${preset}: ${allAlive10}/${seeds.length} seeds with all species alive at 10 min`);
