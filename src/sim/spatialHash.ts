// Uniform bucket grid rebuilt each tick via counting sort (spec §7.4). No per-tick allocations.
import { SPATIAL_BUCKET } from '../config';

export class SpatialHash {
  readonly gw: number; // buckets per row
  readonly cellStart: Int32Array;
  readonly cellCount: Int32Array;
  readonly sortedIndices: Int32Array;
  private readonly cellOf: Int32Array;
  // Result of setRange(): inclusive bucket coordinate range to iterate.
  bx0 = 0;
  bx1 = 0;
  bz0 = 0;
  bz1 = 0;

  constructor(worldSize: number, maxAgents: number) {
    this.gw = Math.ceil(worldSize / SPATIAL_BUCKET);
    this.cellStart = new Int32Array(this.gw * this.gw + 1);
    this.cellCount = new Int32Array(this.gw * this.gw);
    this.sortedIndices = new Int32Array(maxAgents);
    this.cellOf = new Int32Array(maxAgents);
  }

  build(x: Float32Array, z: Float32Array, count: number): void {
    const { gw, cellStart, cellCount, sortedIndices, cellOf } = this;
    cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      let bx = (x[i] / SPATIAL_BUCKET) | 0;
      let bz = (z[i] / SPATIAL_BUCKET) | 0;
      if (bx >= gw) bx = gw - 1;
      if (bz >= gw) bz = gw - 1;
      const c = bz * gw + bx;
      cellOf[i] = c;
      cellCount[c]++;
    }
    let sum = 0;
    for (let c = 0; c < cellCount.length; c++) {
      cellStart[c] = sum;
      sum += cellCount[c];
    }
    cellStart[cellCount.length] = sum;
    // Fill using cellCount as a running cursor, then restore it.
    cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      const c = cellOf[i];
      sortedIndices[cellStart[c] + cellCount[c]++] = i;
    }
  }

  /** Sets bx0..bx1 / bz0..bz1 to the buckets overlapping the circle (x, z, r). Callers iterate them inline. */
  setRange(x: number, z: number, r: number): void {
    const max = this.gw - 1;
    const inv = 1 / SPATIAL_BUCKET;
    let v = Math.floor((x - r) * inv);
    this.bx0 = v < 0 ? 0 : v > max ? max : v;
    v = Math.floor((x + r) * inv);
    this.bx1 = v < 0 ? 0 : v > max ? max : v;
    v = Math.floor((z - r) * inv);
    this.bz0 = v < 0 ? 0 : v > max ? max : v;
    v = Math.floor((z + r) * inv);
    this.bz1 = v < 0 ? 0 : v > max ? max : v;
  }
}
