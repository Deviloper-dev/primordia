// Worker entry: message router + fixed-step loop. Snapshots go out via a ping-pong ArrayBuffer pool.
import {
  FOOD_SEND_EVERY,
  LOOP_INTERVAL_MS,
  MAX_AGENTS,
  MAX_STEPS_PER_LOOP,
  SIM_DT,
  SNAPSHOT_MIN_INTERVAL_MS,
  SNAPSHOT_POOL_SIZE,
  STATS_EVERY,
} from '../config';
import { SNAP_STRIDE } from '../shared/messages';
import type { MainToWorker, WorkerToMain } from '../shared/messages';
import { Simulation } from './simulation';

const ctx = self as unknown as {
  postMessage(msg: WorkerToMain, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<MainToWorker>) => void) | null;
};

const SNAP_BYTES = MAX_AGENTS * SNAP_STRIDE * 4;

let sim: Simulation | null = null;
let paused = false;
let speed = 1;
let acc = 0; // sim seconds owed
let lastLoop = performance.now();
let lastSnapMs = 0;
let selectedId: number | null = null;
const pool: ArrayBuffer[] = [];

function post(msg: WorkerToMain, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function buildSim(m: Extract<MainToWorker, { type: 'init' | 'reset' }>): void {
  sim = new Simulation(m);
  acc = 0;
  selectedId = null;
  const w = sim.world;
  // Copies so the sim keeps its own arrays.
  const height = w.height.slice();
  const water = w.water.slice();
  const fertility = w.fertility.slice();
  post({ type: 'world', size: w.size, height, water, fertility, waterHeight: w.waterHeight }, [height.buffer, water.buffer, fertility.buffer]);
  postAll();
}

function postAgents(): void {
  if (!sim) return;
  const buf = pool.pop() ?? new ArrayBuffer(SNAP_BYTES);
  const view = new Float32Array(buf);
  const count = sim.writeSnapshot(view);
  lastSnapMs = performance.now();
  post({ type: 'agents', tick: sim.tick, time: sim.time, count, buffer: view }, [buf]);
}

function postFood(): void {
  if (!sim) return;
  const out = new Uint8Array(sim.size * sim.size);
  sim.writeFood(out);
  post({ type: 'food', buffer: out }, [out.buffer]);
}

function postStats(): void {
  if (sim) post({ type: 'stats', ...sim.getStats() });
}

function postSelected(): void {
  if (!sim || selectedId === null) return;
  const info = sim.getSelected(selectedId);
  post({ type: 'selected', info });
  if (info === null || !info.alive) selectedId = null; // final message sent
}

/** Everything, regardless of cadence (after reset / manual step / spawn). */
function postAll(): void {
  postAgents();
  postFood();
  postStats();
  postSelected();
}

function stepOnce(): void {
  if (!sim) return;
  sim.step();
  if (sim.tick % FOOD_SEND_EVERY === 0) postFood();
  if (sim.tick % STATS_EVERY === 0) postStats();
  checkPopCap();
}

/** End the run (pause + notify main) once any species reaches params.popCap. */
function checkPopCap(): void {
  if (!sim) return;
  const s = sim.speciesOverCap();
  if (s < 0) return;
  paused = true;
  acc = 0;
  postAll();
  post({ type: 'ended', reason: 'overpopulation', speciesId: s, population: sim.populationOf(s), tick: sim.tick, time: sim.time });
}

function loop(): void {
  const now = performance.now();
  const real = Math.min(now - lastLoop, 250);
  lastLoop = now;
  if (sim && !paused) {
    acc += (real / 1000) * speed;
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_STEPS_PER_LOOP && !paused) {
      stepOnce();
      acc -= SIM_DT;
      steps++;
    }
    if (acc >= SIM_DT) acc = 0; // spiral-of-death guard: drop the excess
    if (steps > 0) {
      postSelected();
      if (now - lastSnapMs >= SNAPSHOT_MIN_INTERVAL_MS) postAgents();
    }
  }
  setTimeout(loop, LOOP_INTERVAL_MS);
}

ctx.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
    case 'reset':
      buildSim(m);
      break;
    case 'setPaused':
      paused = m.paused;
      lastLoop = performance.now();
      break;
    case 'step':
      stepOnce();
      postAll();
      break;
    case 'setSpeed':
      speed = m.multiplier;
      break;
    case 'setParams':
      sim?.setParams(m.params);
      break;
    case 'setSpecies':
      sim?.setSpecies(m.species);
      break;
    case 'spawn':
      if (sim) {
        sim.spawn(m.speciesId, m.x, m.z, m.count, m.radius);
        if (paused) postAgents();
      }
      break;
    case 'select':
      selectedId = m.agentId;
      postSelected();
      if (selectedId === null) post({ type: 'selected', info: null });
      break;
    case 'returnBuffer':
      if (m.buffer.byteLength === SNAP_BYTES && pool.length < SNAPSHOT_POOL_SIZE) pool.push(m.buffer);
      break;
  }
};

loop();
