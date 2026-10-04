// ALL tunable numbers live here. Never hard-code balancing constants elsewhere.
import type { Genome, Preset, PresetId, SimParams, SpeciesDef, TraitName } from './shared/types';

// ---------------- Capacity & timing ----------------
export const MAX_AGENTS = 20000;
export const MIN_SPECIES = 2;
export const MAX_SPECIES = 4;
export const SIM_DT = 1 / 20; // fixed timestep (s)
export const ENV_TICK_EVERY = 2; // food CA runs every N sim ticks
export const DECISION_EVERY = 4; // re-decide every N ticks, staggered by id % N
export const FOOD_SEND_EVERY = 5; // ticks
export const STATS_EVERY = 10; // ticks
export const SNAPSHOT_MIN_INTERVAL_MS = 1000 / 30; // agent snapshots capped to ~30/s
export const MAX_STEPS_PER_LOOP = 40; // spiral-of-death guard
export const LOOP_INTERVAL_MS = 1000 / 60; // worker loop cadence
export const SPATIAL_BUCKET = 8; // cells per spatial-hash bucket
export const SNAPSHOT_POOL_SIZE = 4;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 16;

// ---------------- World ----------------
export const DEFAULT_WORLD_SIZE = 192;
export const WORLD_SIZE_OPTIONS = [96, 128, 192, 256];
export const TERRAIN = {
  heightNoiseScale: 1 / 48, // octave 1 frequency (per cell)
  heightOctave2Scale: 1 / 16,
  heightOctave2Weight: 0.35,
  fertilityNoiseScale: 1 / 40,
  fertilityMin: 0.2,
  fertilityMax: 1.0,
};

// ---------------- Default simulation params ----------------
export const DEFAULT_PARAMS: SimParams = {
  growthRate: 0.153,
  sproutAmount: 0.15,
  sproutChance: 0.3,
  seedChance: 0.00002,
  initialFoodCoverage: 0.4,
  corpseNutrient: 0.5,
  waterLevel: 0.12,

  plantEnergy: 7.387,
  biteRate: 0.241,
  meatEnergy: 65,
  meatEfficiency: 0.8,
  sizeRule: true,
  sizeRuleRatio: 1.5,
  attackCooldown: 1.101,
  fightDamage: 15.655,
  fleeAfterLoss: 1,

  kBasal: 0.22,
  kMove: 0.023,
  kSense: 0.03,
  capacityPerSize2: 56.585,

  hungerThreshold: 0.672,
  wanderSpeedFactor: 0.35,
  separationRadius: 1,
  separationStrength: 2,
  steerAccel: 3,

  offspringEnergyFraction: 0.306,
  reproCost: 18.291,
  reproCooldown: 28,
  mutationRate: 0.05,
  bigMutationChance: 0.01,
  bigMutationMultiplier: 4,

  // Run ends when any species reaches this population (keeps render perf in budget; 0 = off).
  popCap: 4000,
};

// ---------------- Genome ----------------
export const TRAIT_RANGES: Record<TraitName, [number, number]> = {
  size: [0.5, 2.0],
  speed: [1, 10],
  sense: [2, 16],
  aggression: [0, 1],
  fear: [0, 1],
  fertility: [0.3, 0.9],
  lifespan: [30, 180],
  hue: [-0.1, 0.1],
};

const BASE_GENOME: Genome = {
  size: 1,
  speed: 4,
  sense: 6,
  aggression: 0.2,
  fear: 0.5,
  fertility: 0.6,
  lifespan: 90,
  hue: 0,
};

export function makeGenome(overrides: Partial<Genome> = {}): Genome {
  return { ...BASE_GENOME, ...overrides };
}

// ---------------- Presets ----------------
const classic: SpeciesDef[] = [
  {
    name: 'Grazers',
    color: '#7bd389',
    archetype: 'grazer',
    diet: { plants: true, eats: [] },
    baseGenome: makeGenome({ size: 1.16, speed: 4.664, sense: 6.661, aggression: 0.05, fear: 0.417, fertility: 0.677, lifespan: 90 }),
    initialCount: 300,
  },
  {
    name: 'Hunters',
    color: '#e4572e',
    archetype: 'hunter',
    diet: { plants: false, eats: [0] },
    baseGenome: makeGenome({ size: 1.085, speed: 5.5, sense: 10.164, aggression: 0.442, fear: 0.2, fertility: 0.85, lifespan: 180 }),
    initialCount: 30,
  },
  {
    name: 'Omnivores',
    color: '#f3a712',
    archetype: 'tank',
    diet: { plants: true, eats: [0], smallerPreyOnly: true },
    baseGenome: makeGenome({ size: 1.005, speed: 3.09, sense: 7, aggression: 0.106, fear: 0.4, fertility: 0.9, lifespan: 100 }),
    initialCount: 80,
  },
];

// Arrow A -> B means "B eats A". Red -> Green -> Blue -> Red.
const rps: SpeciesDef[] = [
  {
    name: 'Red',
    color: '#e63946',
    archetype: 'hunter',
    diet: { plants: true, eats: [2] },
    baseGenome: makeGenome({ size: 1, speed: 4.5, sense: 7, aggression: 0.5, fear: 0.5 }),
    initialCount: 150,
  },
  {
    name: 'Green',
    color: '#52b788',
    archetype: 'grazer',
    diet: { plants: true, eats: [0] },
    baseGenome: makeGenome({ size: 1, speed: 4.5, sense: 7, aggression: 0.5, fear: 0.5 }),
    initialCount: 150,
  },
  {
    name: 'Blue',
    color: '#4895ef',
    archetype: 'swarmer',
    diet: { plants: true, eats: [1] },
    baseGenome: makeGenome({ size: 1, speed: 4.5, sense: 7, aggression: 0.5, fear: 0.5 }),
    initialCount: 150,
  },
];

const fourKingdoms: SpeciesDef[] = [
  {
    name: 'Hoppers',
    color: '#b5e48c',
    archetype: 'swarmer',
    diet: { plants: true, eats: [] },
    baseGenome: makeGenome({ size: 0.7, speed: 6, sense: 6, aggression: 0, fear: 0.7, fertility: 0.5, lifespan: 60 }),
    initialCount: 250,
  },
  {
    name: 'Bulks',
    color: '#9c6644',
    archetype: 'tank',
    diet: { plants: true, eats: [] },
    baseGenome: makeGenome({ size: 1.7, speed: 2.5, sense: 5, aggression: 0.1, fear: 0.3, fertility: 0.7, lifespan: 150 }),
    initialCount: 80,
  },
  {
    name: 'Stalkers',
    color: '#f77f00',
    archetype: 'hunter',
    diet: { plants: false, eats: [0, 1] },
    baseGenome: makeGenome({ size: 1.2, speed: 5.5, sense: 10, aggression: 0.7, fear: 0.4, fertility: 0.7, lifespan: 110 }),
    initialCount: 30,
  },
  {
    name: 'Apex',
    color: '#7209b7',
    archetype: 'hunter',
    diet: { plants: false, eats: [2] },
    baseGenome: makeGenome({ size: 1.8, speed: 6, sense: 14, aggression: 0.8, fear: 0.1, fertility: 0.75, lifespan: 160 }),
    initialCount: 8,
  },
];

const duel: SpeciesDef[] = [
  {
    name: 'Ochre',
    color: '#e9c46a',
    archetype: 'grazer',
    diet: { plants: true, eats: [] },
    baseGenome: makeGenome({ size: 0.9, speed: 5, sense: 6, fertility: 0.55 }),
    initialCount: 200,
  },
  {
    name: 'Teal',
    color: '#2a9d8f',
    archetype: 'tank',
    diet: { plants: true, eats: [] },
    baseGenome: makeGenome({ size: 1.2, speed: 3.5, sense: 8, fertility: 0.65 }),
    initialCount: 200,
  },
];

export const PRESETS: Record<PresetId, Preset> = {
  classic: { id: 'classic', name: 'Classic', species: classic },
  rps: { id: 'rps', name: 'Rock–Paper–Scissors', species: rps },
  fourKingdoms: { id: 'fourKingdoms', name: 'Four Kingdoms', species: fourKingdoms },
  duel: { id: 'duel', name: 'Duel', species: duel },
};
export const DEFAULT_PRESET: PresetId = 'classic';

/** Deep copy so UI edits never mutate the preset tables. */
export function clonePresetSpecies(id: PresetId): SpeciesDef[] {
  return structuredClone(PRESETS[id].species);
}

/** Template for the "add species" button. */
export function newSpeciesTemplate(index: number): SpeciesDef {
  const palette = ['#06d6a0', '#ef476f', '#118ab2', '#ffd166'];
  return {
    name: `Species ${index + 1}`,
    color: palette[index % palette.length],
    archetype: 'swarmer',
    diet: { plants: true, eats: [] },
    baseGenome: makeGenome(),
    initialCount: 60,
  };
}

// ---------------- Sim internals (behavior / interactions) ----------------
export const SIM = {
  contactFactor: 0.6, // combat range = factor * (sizeA + sizeB)
  foodSamples: 10, // random cells sampled within sense when looking for food
  plantResidual: 0.047, // grazing never reduces a cell below this (roots survive)
  foodMinValue: 0.12, // ignore cells with less food than this
  foodDistWeight: 0.15, // score = food / (1 + dist * weight)
  huntRollScale: 0.05, // non-hungry hunt urge = aggression * scale, per second
  satiatedRatio: 0.9, // energy/capacity above which predators never start a hunt (no surplus killing)
  huntPersist: 0.85, // min hunt chance while already hunting
  wanderTurnRate: 2.5, // rad/s random walk of wander angle
  grazeSpeedFactor: 0.7,
  reproSpeedFactor: 0.2,
  fightSpeedFactor: 0.5,
  arriveDistance: 0.3, // graze: stop when this close to the cell center
  leadTimeMax: 1, // s, cap on lead-targeting prediction
  lookahead: 1.5, // cells, water/edge probe distance
  avoidAngles: [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0], // radians tried when blocked
  bounce: 0.3, // velocity kept (reflected) when blocked by water/edge
  minHeadingSpeed: 0.2, // update heading only above this speed
  initialEnergyMin: 0.5,
  initialEnergyMax: 0.7,
  initialCooldownSpread: 2, // founders' initial repro cooldown = random * reproCooldown * this
  initialAgeFraction: 0.6, // initial age = random * fraction * lifespan
  spawnMutationScale: 0.5, // mutation strength for initial/brush spawns
  childSpawnTries: 6,
  childSpawnRadius: 1,
};

// ---------------- Rendering ----------------
export const RENDER = {
  heightScale: 14, // world units of vertical exaggeration for normalized height 1.0
  creatureBaseScale: 0.9,
  bobAmplitude: 0.12,
  bobFrequency: 8,
  fogNear: 120,
  fogFar: 420,
  skyColor: '#a9d6f5',
  soilColor: '#8a6a45',
  lushColor: '#3f8f3a',
  waterColor: '#3a7bd5',
  waterOpacity: 0.7,
  cameraMinDistance: 15,
  cameraMaxDistance: 400,
  cameraMaxPolarAngle: Math.PI * 0.45,
  scaleInSeconds: 0.25,
  hungryDarken: 0.55, // color multiplier at energyRatio 0
  fleeBrighten: 1.3,
  huntRedShift: 0.35,
  maxPixelRatio: 2,
  cameraFov: 50,
  cameraNear: 0.5,
  cameraFar: 1500,
  hemiSkyColor: '#dff1ff',
  hemiGroundColor: '#6b5a45',
  hemiIntensity: 1.6,
  sunColor: '#fff2dc',
  sunIntensity: 2.4,
  sunDirection: [0.6, 1, 0.4] as [number, number, number],
  shadowMapSize: 2048,
  fertilityTint: 0.25, // how much fertility modulates the lush color
  creatureHueJitter: 0.012, // hue step per (id % 7) bucket
  creatureLift: 0.05, // body origin above terrain
  ringLift: 0.2,
  selectionRingScale: 1.5,
  selectionColor: '#ffffff',
  senseRingColor: '#ffffff',
  senseRingOpacity: 0.45,
  followLerp: 0.12,
  cameraStartPolar: 0.9, // radians from vertical
  cameraStartDistanceFactor: 1.1, // x world size
};

// ---------------- UI ----------------
export const UI = {
  chartWindowSeconds: 180,
  chartWidth: 360,
  chartHeight: 140,
  brushDefaultCount: 10,
  brushDefaultRadius: 4,
  spawnRandomCount: 20,
  toastSeconds: 5,
  clickMaxMovePx: 5,
  spawnRandomRadius: 30,
  hudUpdateMs: 250,
  chartMinSpanSeconds: 10,
};
