// Main <-> Worker message protocol (spec §3).
import type { PresetId, RunEnd, SelectedAgentInfo, SimParams, SpeciesDef, StatsPayload } from './types';

// ---------- Agent snapshot layout: 8 floats per agent ----------
export const SNAP_STRIDE = 8;
export const SNAP_ID = 0;
export const SNAP_SPECIES = 1;
export const SNAP_X = 2;
export const SNAP_Z = 3;
export const SNAP_HEADING = 4;
export const SNAP_SIZE = 5;
export const SNAP_STATE = 6;
export const SNAP_ENERGY = 7; // energy / capacity, 0..1

/** Payload shared by init and reset. Main resolves presets into concrete species before sending. */
export interface WorldSetup {
  seed: number;
  preset: PresetId;
  worldSize: number;
  species: SpeciesDef[];
  params: SimParams;
}

export type MainToWorker =
  | ({ type: 'init' } & WorldSetup)
  | ({ type: 'reset' } & WorldSetup)
  | { type: 'setPaused'; paused: boolean }
  | { type: 'step' } // advance exactly one tick (while paused)
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'setParams'; params: Partial<SimParams> }
  /** Same species count only (diet/genome/color edits). Changing the count is done via reset. */
  | { type: 'setSpecies'; species: SpeciesDef[] }
  | { type: 'spawn'; speciesId: number; x: number; z: number; count: number; radius: number }
  | { type: 'select'; agentId: number | null }
  | { type: 'returnBuffer'; buffer: ArrayBuffer };

export type WorkerToMain =
  /** Sent once after init/reset. Grid is size*size, row-major, index = z * size + x. */
  | {
      type: 'world';
      size: number;
      height: Float32Array; // normalized 0..1
      water: Uint8Array; // 1 = water
      fertility: Float32Array; // 0.2..1
      waterHeight: number; // normalized height of the water surface
    }
  | { type: 'agents'; tick: number; time: number; count: number; buffer: Float32Array }
  | { type: 'food'; buffer: Uint8Array } // size*size, 0..255
  | ({ type: 'stats' } & StatsPayload)
  /** Every tick while selected. When the agent dies, one final message with alive=false, then nothing. */
  | { type: 'selected'; info: SelectedAgentInfo | null }
  /** The run stopped itself (e.g. a species hit params.popCap). Worker is paused when this arrives. */
  | ({ type: 'ended' } & RunEnd);
