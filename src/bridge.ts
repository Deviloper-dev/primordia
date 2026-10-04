// Worker lifecycle, typed send helpers, and snapshot interpolation state.
import { RENDER } from './config';
import { SNAP_ID, SNAP_STRIDE } from './shared/messages';
import type { MainToWorker, WorkerToMain, WorldSetup } from './shared/messages';
import type { RunEnd, SelectedAgentInfo, SimParams, SpeciesDef, StatsPayload } from './shared/types';

export interface Snapshot {
  buffer: Float32Array | null;
  count: number;
  tick: number;
  time: number; // sim time
  arrivedAt: number; // performance.now()
  index: Map<number, number>; // agent id -> float offset
}

export interface BridgeHandlers {
  onWorld(msg: Extract<WorkerToMain, { type: 'world' }>): void;
  onFood(buffer: Uint8Array): void;
  onStats(stats: StatsPayload): void;
  onSelected(info: SelectedAgentInfo | null): void;
  onEnded(end: RunEnd): void;
}

function emptySnapshot(): Snapshot {
  return { buffer: null, count: 0, tick: 0, time: 0, arrivedAt: 0, index: new Map() };
}

const MIN_INTERVAL_MS = 16;
const MAX_INTERVAL_MS = 500;

export class SimBridge {
  private worker: Worker;
  prev: Snapshot = emptySnapshot();
  cur: Snapshot = emptySnapshot();
  hasPrev = false;
  /** id -> arrival time (ms) of recently appeared agents, for scale-in. */
  born = new Map<number, number>();
  private interval = 50; // measured snapshot interval (ms)

  constructor(private handlers: BridgeHandlers) {
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.onMessage(e.data);
  }

  private post(msg: MainToWorker, transfer?: Transferable[]) {
    if (transfer) this.worker.postMessage(msg, transfer);
    else this.worker.postMessage(msg);
  }

  private onMessage(msg: WorkerToMain) {
    switch (msg.type) {
      case 'world':
        this.dropSnapshots();
        this.handlers.onWorld(msg);
        break;
      case 'agents':
        this.pushSnapshot(msg.buffer, msg.count, msg.tick, msg.time);
        break;
      case 'food':
        this.handlers.onFood(msg.buffer);
        break;
      case 'stats':
        this.handlers.onStats(msg);
        break;
      case 'selected':
        this.handlers.onSelected(msg.info);
        break;
      case 'ended':
        this.handlers.onEnded(msg);
        break;
    }
  }

  private pushSnapshot(buffer: Float32Array, count: number, tick: number, time: number) {
    const now = performance.now();
    // Recycle the dropped snapshot's buffer and Map.
    const dropped = this.prev;
    if (dropped.buffer) this.returnBuffer(dropped.buffer);
    this.prev = this.cur;
    this.hasPrev = this.prev.buffer !== null;
    this.cur = dropped;

    const cur = this.cur;
    if (this.hasPrev) {
      const dt = now - this.prev.arrivedAt;
      this.interval = this.interval * 0.8 + Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, dt)) * 0.2;
    }
    cur.buffer = buffer;
    cur.count = count;
    cur.tick = tick;
    cur.time = time;
    cur.arrivedAt = now;
    cur.index.clear();
    const prevIndex = this.prev.index;
    const fresh = this.hasPrev;
    for (let i = 0; i < count; i++) {
      const id = buffer[i * SNAP_STRIDE + SNAP_ID];
      cur.index.set(id, i * SNAP_STRIDE);
      if (fresh && !prevIndex.has(id)) this.born.set(id, now);
    }
    // prune old scale-in entries
    const maxAge = RENDER.scaleInSeconds * 1000 + this.interval * 2;
    for (const [id, t] of this.born) if (now - t > maxAge) this.born.delete(id);
  }

  private dropSnapshots() {
    for (const s of [this.prev, this.cur]) {
      if (s.buffer) this.returnBuffer(s.buffer);
      s.buffer = null;
      s.count = 0;
      s.index.clear();
    }
    this.hasPrev = false;
    this.born.clear();
  }

  private returnBuffer(buf: Float32Array) {
    this.post({ type: 'returnBuffer', buffer: buf.buffer as ArrayBuffer }, [buf.buffer as ArrayBuffer]);
  }

  /** Interpolation factor between prev and cur snapshots, 0..1. */
  alpha(now: number): number {
    if (!this.hasPrev) return 1;
    const a = (now - this.cur.arrivedAt) / this.interval;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  // ---- send helpers ----
  init(setup: WorldSetup) {
    this.post({ type: 'init', ...setup });
  }
  reset(setup: WorldSetup) {
    this.dropSnapshots();
    this.post({ type: 'reset', ...setup });
  }
  setPaused(paused: boolean) {
    this.post({ type: 'setPaused', paused });
  }
  step() {
    this.post({ type: 'step' });
  }
  setSpeed(multiplier: number) {
    this.post({ type: 'setSpeed', multiplier });
  }
  setParams(params: Partial<SimParams>) {
    this.post({ type: 'setParams', params });
  }
  setSpecies(species: SpeciesDef[]) {
    this.post({ type: 'setSpecies', species: structuredClone(species) });
  }
  spawn(speciesId: number, x: number, z: number, count: number, radius: number) {
    this.post({ type: 'spawn', speciesId, x, z, count, radius });
  }
  select(agentId: number | null) {
    this.post({ type: 'select', agentId });
  }
}
