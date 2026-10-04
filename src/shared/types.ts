// Shared domain types used by both the worker (sim) and main thread (render/UI).

export const TRAITS = ['size', 'speed', 'sense', 'aggression', 'fear', 'fertility', 'lifespan', 'hue'] as const;
export type TraitName = (typeof TRAITS)[number];
export type Genome = Record<TraitName, number>;

/** Traits that can be charted / compared (hue & lifespan are omitted from the chart dropdown). */
export const CHART_TRAITS = ['size', 'speed', 'sense', 'aggression', 'fear'] as const;
export type ChartTrait = (typeof CHART_TRAITS)[number];

export type Archetype = 'grazer' | 'hunter' | 'tank' | 'swarmer';

export interface Diet {
  plants: boolean;
  /** Species indices this species can eat. */
  eats: number[];
  /** If true, may only kill prey strictly smaller than itself (Omnivore rule). */
  smallerPreyOnly?: boolean;
}

export interface SpeciesDef {
  name: string;
  /** '#rrggbb' */
  color: string;
  archetype: Archetype;
  diet: Diet;
  baseGenome: Genome;
  initialCount: number;
}

export type PresetId = 'classic' | 'rps' | 'fourKingdoms' | 'duel';

export interface Preset {
  id: PresetId;
  name: string;
  species: SpeciesDef[];
}

/** Agent behavior state. Plain const object (not enum) so it survives isolatedModules. */
export const AgentState = {
  WANDER: 0,
  GRAZE: 1,
  HUNT: 2,
  FLEE: 3,
  REPRODUCE: 4,
  FIGHT: 5,
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];
export const AGENT_STATE_NAMES = ['wander', 'graze', 'hunt', 'flee', 'reproduce', 'fight'] as const;

export type DeathCause = 'starvation' | 'eaten' | 'oldAge';

/** Live-tunable simulation parameters. Defaults live in config.ts (DEFAULT_PARAMS). */
export interface SimParams {
  // --- Environment (food CA) ---
  growthRate: number; // logistic growth per second
  sproutAmount: number;
  sproutChance: number;
  seedChance: number; // per bare cell per env tick
  initialFoodCoverage: number; // fraction of land cells starting with food
  corpseNutrient: number; // food added per unit size on death
  /** Target fraction of the map that is water (applies on reset). */
  waterLevel: number;

  // --- Eating & combat ---
  plantEnergy: number;
  biteRate: number;
  meatEnergy: number;
  meatEfficiency: number; // 0.8 in spec
  /** Size rule: a predator may only kill prey with size <= predator.size * sizeRuleRatio. */
  sizeRule: boolean;
  sizeRuleRatio: number;
  attackCooldown: number; // s
  fightDamage: number; // energy lost per unit prey size on a lost fight
  fleeAfterLoss: number; // s

  // --- Energy model ---
  kBasal: number;
  kMove: number;
  kSense: number;
  capacityPerSize2: number; // capacity = this * size^2

  // --- Behavior ---
  hungerThreshold: number; // fraction of capacity
  wanderSpeedFactor: number; // fraction of max speed while wandering
  separationRadius: number; // cells
  separationStrength: number;
  steerAccel: number; // max acceleration in cells/s^2 per unit speed

  // --- Reproduction & evolution ---
  offspringEnergyFraction: number; // 0.45
  reproCost: number;
  reproCooldown: number; // s
  mutationRate: number;
  bigMutationChance: number;
  bigMutationMultiplier: number;

  // --- Run end ---
  /** Per-species population at which the run ends with an over-population outcome (0 = no cap). */
  popCap: number;
}

/** Why a run stopped on its own. */
export interface RunEnd {
  reason: 'overpopulation';
  speciesId: number;
  population: number;
  tick: number;
  time: number;
}

export interface StatsPayload {
  tick: number;
  time: number; // sim seconds
  populations: number[]; // per species
  avgTraits: Genome[]; // per species (zeros when extinct)
  births: number[]; // since last stats message
  deaths: number[]; // since last stats message
  /** Total food / land cell count, 0..1. */
  plantBiomass: number;
}

export interface SelectedAgentInfo {
  id: number;
  alive: boolean;
  deathCause?: DeathCause;
  species: number;
  generation: number;
  parentId: number;
  age: number;
  energy: number;
  capacity: number;
  state: AgentState;
  genome: Genome;
  kills: number;
  offspring: number;
  x: number;
  z: number;
}
