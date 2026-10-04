import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import type { Creatures } from './creatures';
import type { Terrain } from './terrain';

// Instanced meshes are tiny on screen, so instead of triangle raycasts we measure the distance
// from the pick ray to each instance's position (read back from the instance matrices that were
// just written for rendering) with a tolerance that grows with distance. Instance index -> agent id
// goes through each species' `ids` table.
const BASE_RADIUS = 0.9;
const ANGULAR_RADIUS = 0.012; // extra tolerance per unit distance

export class Picker {
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private p = new Vector3();

  constructor(
    private camera: PerspectiveCamera,
    private dom: HTMLElement,
    private creatures: Creatures,
    private terrain: Terrain,
  ) {}

  private setRay(clientX: number, clientY: number) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  /** Nearest creature under the cursor, or null. */
  pickAgent(clientX: number, clientY: number): number | null {
    this.setRay(clientX, clientY);
    const ray = this.raycaster.ray;
    let best: number | null = null;
    let bestT = Infinity;
    for (const s of this.creatures.species) {
      const m = s.mesh.instanceMatrix.array;
      for (let i = 0; i < s.count; i++) {
        const k = i * 16;
        this.p.set(m[k + 12], m[k + 13] + 0.3, m[k + 14]);
        const t = this.p.distanceTo(ray.origin);
        const tol = BASE_RADIUS + t * ANGULAR_RADIUS;
        if (ray.distanceSqToPoint(this.p) < tol * tol && t < bestT) {
          bestT = t;
          best = s.ids[i];
        }
      }
    }
    return best;
  }

  /** World (x, z) where the cursor ray meets the terrain, or null. */
  pickTerrain(clientX: number, clientY: number): [number, number] | null {
    if (!this.terrain.mesh) return null;
    this.setRay(clientX, clientY);
    const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
    return hit ? [hit.point.x, hit.point.z] : null;
  }
}
