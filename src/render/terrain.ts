import {
  BufferAttribute,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RedFormat,
  UnsignedByteType,
} from 'three';
import { RENDER } from '../config';

// Grid state shared with creatures/picking (module-level so heightAt is a plain function).
let gridSize = 0;
let heights: Float32Array = new Float32Array(0); // normalized 0..1
let waterGrid: Uint8Array = new Uint8Array(0);

/** Terrain surface height in world units at world position (x, z). Cell (i,j) is centered at (i+0.5, j+0.5). */
export function heightAt(x: number, z: number): number {
  if (gridSize === 0) return 0;
  const max = gridSize - 1;
  let gx = x - 0.5;
  let gz = z - 0.5;
  gx = gx < 0 ? 0 : gx > max ? max : gx;
  gz = gz < 0 ? 0 : gz > max ? max : gz;
  const x0 = Math.min(max - 1, Math.floor(gx));
  const z0 = Math.min(max - 1, Math.floor(gz));
  const fx = gx - x0;
  const fz = gz - z0;
  const i = z0 * gridSize + x0;
  const h00 = heights[i];
  const h10 = heights[i + 1];
  const h01 = heights[i + gridSize];
  const h11 = heights[i + gridSize + 1];
  const h = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  return h * RENDER.heightScale;
}

/** Random land point (x, z) in world coordinates; falls back to the center. */
export function randomLandPoint(): [number, number] {
  for (let k = 0; k < 200; k++) {
    const x = Math.floor(Math.random() * gridSize);
    const z = Math.floor(Math.random() * gridSize);
    if (!waterGrid[z * gridSize + x]) return [x + 0.5, z + 0.5];
  }
  return [gridSize / 2, gridSize / 2];
}

export class Terrain {
  readonly group = new Group();
  mesh: Mesh | null = null;
  private water: Mesh | null = null;
  private foodTex: DataTexture | null = null;
  private fertTex: DataTexture | null = null;
  private overlay = { value: 1 };
  private uniforms = {
    foodMap: { value: null as DataTexture | null },
    fertMap: { value: null as DataTexture | null },
    uSize: { value: 1 },
    uSoil: { value: new Color(RENDER.soilColor) },
    uLush: { value: new Color(RENDER.lushColor) },
    uOverlay: this.overlay,
    uTint: { value: RENDER.fertilityTint },
  };

  setOverlay(on: boolean) {
    this.overlay.value = on ? 1 : 0;
  }

  /** Rebuild meshes/textures from a 'world' message. */
  build(size: number, height: Float32Array, water: Uint8Array, fertility: Float32Array, waterHeight: number) {
    this.dispose();
    gridSize = size;
    heights = height;
    waterGrid = water;

    const geo = new PlaneGeometry(size - 1, size - 1, size - 1, size - 1);
    const pos = geo.getAttribute('position') as BufferAttribute;
    // Vertex order matches the grid (row = z, col = x), so overwrite positions directly.
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, (i % size) + 0.5, height[i] * RENDER.heightScale, Math.floor(i / size) + 0.5);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    this.foodTex = this.makeTexture(size, new Uint8Array(size * size));
    const fert = new Uint8Array(size * size);
    for (let i = 0; i < fert.length; i++) fert[i] = Math.round(Math.min(1, fertility[i]) * 255);
    this.fertTex = this.makeTexture(size, fert);
    this.uniforms.foodMap.value = this.foodTex;
    this.uniforms.fertMap.value = this.fertTex;
    this.uniforms.uSize.value = size;

    const mat = new MeshStandardMaterial({ flatShading: true, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFoodUv;\nuniform float uSize;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoodUv = position.xz / uSize;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vFoodUv;
uniform sampler2D foodMap;
uniform sampler2D fertMap;
uniform vec3 uSoil;
uniform vec3 uLush;
uniform float uOverlay;
uniform float uTint;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float fert = texture2D(fertMap, vFoodUv).r;
float food = texture2D(foodMap, vFoodUv).r * uOverlay;
vec3 soil = uSoil * (0.9 + 0.2 * fert);
diffuseColor.rgb = mix(soil, uLush * (1.0 - uTint + uTint * fert), clamp(food, 0.0, 1.0));`,
        );
    };
    this.mesh = new Mesh(geo, mat);
    this.mesh.receiveShadow = true;

    const wgeo = new PlaneGeometry(size, size);
    wgeo.rotateX(-Math.PI / 2);
    this.water = new Mesh(
      wgeo,
      new MeshStandardMaterial({
        color: RENDER.waterColor,
        transparent: true,
        opacity: RENDER.waterOpacity,
        roughness: 0.3,
        depthWrite: false,
      }),
    );
    this.water.position.set(size / 2, waterHeight * RENDER.heightScale, size / 2);

    this.group.add(this.mesh, this.water);
  }

  setFood(buffer: Uint8Array) {
    const tex = this.foodTex;
    if (!tex || buffer.length !== (tex.image.data as Uint8Array).length) return;
    (tex.image.data as Uint8Array).set(buffer);
    tex.needsUpdate = true;
  }

  private makeTexture(size: number, data: Uint8Array): DataTexture {
    const t = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }

  private dispose() {
    for (const m of [this.mesh, this.water]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
    this.foodTex?.dispose();
    this.fertTex?.dispose();
    this.mesh = this.water = null;
  }
}
