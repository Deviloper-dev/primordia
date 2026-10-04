// Terrain generation: height, water mask, fertility. Grid is row-major, idx = z * size + x.
import { createNoise2D } from 'simplex-noise';
import { TERRAIN } from '../config';
import type { Rng } from '../shared/rng';

export class World {
  readonly size: number;
  readonly height: Float32Array; // normalized 0..1
  readonly water: Uint8Array; // 1 = water
  readonly fertility: Float32Array;
  readonly waterHeight: number;
  readonly landIndices: Int32Array; // cell indices of all land cells
  readonly landCells: number;

  constructor(size: number, waterFraction: number, rng: Rng) {
    this.size = size;
    const n = size * size;
    const heightNoise = createNoise2D(() => rng.next());
    const fertNoise = createNoise2D(() => rng.next());
    this.height = new Float32Array(n);
    this.water = new Uint8Array(n);
    this.fertility = new Float32Array(n);

    const w2 = TERRAIN.heightOctave2Weight;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const v =
          heightNoise(x * TERRAIN.heightNoiseScale, z * TERRAIN.heightNoiseScale) +
          w2 * heightNoise(x * TERRAIN.heightOctave2Scale + 100, z * TERRAIN.heightOctave2Scale + 100);
        const i = z * size + x;
        this.height[i] = (v / (1 + w2) + 1) / 2;
        const f = (fertNoise(x * TERRAIN.fertilityNoiseScale, z * TERRAIN.fertilityNoiseScale) + 1) / 2;
        this.fertility[i] = TERRAIN.fertilityMin + (TERRAIN.fertilityMax - TERRAIN.fertilityMin) * f;
      }
    }

    // Water = lowest `waterFraction` of cells.
    const sorted = Float32Array.from(this.height).sort();
    const k = Math.min(n - 1, Math.max(0, Math.floor(waterFraction * n)));
    this.waterHeight = sorted[k];
    let land = 0;
    for (let i = 0; i < n; i++) {
      this.water[i] = this.height[i] < this.waterHeight ? 1 : 0;
      if (!this.water[i]) land++;
    }
    this.landCells = land;
    this.landIndices = new Int32Array(land);
    let j = 0;
    for (let i = 0; i < n; i++) if (!this.water[i]) this.landIndices[j++] = i;
  }

  /** True if continuous position (x, z) is inside the grid and on land. */
  isLand(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return false;
    return this.water[(z | 0) * this.size + (x | 0)] === 0;
  }
}
