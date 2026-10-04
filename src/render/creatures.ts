import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Sphere,
  Vector3,
} from 'three';
import type { SimBridge } from '../bridge';
import { MAX_AGENTS, RENDER } from '../config';
import {
  SNAP_ENERGY,
  SNAP_HEADING,
  SNAP_ID,
  SNAP_SIZE,
  SNAP_SPECIES,
  SNAP_STATE,
  SNAP_STRIDE,
  SNAP_X,
  SNAP_Z,
} from '../shared/messages';
import { AgentState } from '../shared/types';
import type { Archetype, SpeciesDef } from '../shared/types';
import { createArchetypeGeometry } from './geometries';
import { heightAt } from './terrain';

const PALETTE = 7; // jitter buckets, indexed by id % 7
const TWO_PI = Math.PI * 2;

interface SpeciesMesh {
  mesh: InstancedMesh;
  archetype: Archetype;
  ids: Int32Array; // instance index -> agent id (for picking)
  count: number;
  palette: Float32Array; // PALETTE * 3 rgb
}

export class Creatures {
  readonly group = new Group();
  readonly species: SpeciesMesh[] = [];
  private material = new MeshStandardMaterial({ flatShading: true, roughness: 0.8 });
  private ring: Mesh;
  private senseRing: Mesh;
  private selectedId: number | null = null;
  private senseRadius = 0;
  showSense = false;
  private lastAlpha = 1;
  private tmpColor = new Color();
  private readonly bigSphere = new Sphere(new Vector3(), 1e6);

  constructor(private bridge: SimBridge) {
    const ringMat = (opacity: number, color: string) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const ringGeo = new RingGeometry(0.8, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new Mesh(ringGeo, ringMat(0.95, RENDER.selectionColor));
    const senseGeo = new RingGeometry(0.985, 1, 96);
    senseGeo.rotateX(-Math.PI / 2);
    this.senseRing = new Mesh(senseGeo, ringMat(RENDER.senseRingOpacity, RENDER.senseRingColor));
    this.ring.visible = this.senseRing.visible = false;
    this.ring.renderOrder = this.senseRing.renderOrder = 10;
    this.group.add(this.ring, this.senseRing);
  }

  /** (Re)configure meshes for the species list; reuses meshes whose archetype is unchanged. */
  setSpecies(defs: SpeciesDef[]) {
    while (this.species.length > defs.length) {
      const s = this.species.pop()!;
      this.group.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.dispose();
    }
    defs.forEach((def, i) => {
      let s = this.species[i];
      if (s && s.archetype !== def.archetype) {
        this.group.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.dispose();
        s = undefined as unknown as SpeciesMesh;
      }
      if (!s) {
        const mesh = new InstancedMesh(createArchetypeGeometry(def.archetype), this.material, MAX_AGENTS);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_AGENTS * 3), 3);
        mesh.instanceColor.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.boundingSphere = this.bigSphere;
        mesh.count = 0;
        this.group.add(mesh);
        s = {
          mesh,
          archetype: def.archetype,
          ids: new Int32Array(MAX_AGENTS),
          count: 0,
          palette: new Float32Array(PALETTE * 3),
        };
        this.species[i] = s;
      }
      const c = this.tmpColor.set(def.color);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      for (let k = 0; k < PALETTE; k++) {
        c.setHSL(hsl.h + (k - 3) * RENDER.creatureHueJitter, hsl.s, hsl.l);
        s.palette[k * 3] = c.r;
        s.palette[k * 3 + 1] = c.g;
        s.palette[k * 3 + 2] = c.b;
      }
    });
  }

  setCastShadow(on: boolean) {
    for (const s of this.species) s.mesh.castShadow = on;
  }

  setSelection(id: number | null, senseRadius: number) {
    this.selectedId = id;
    this.senseRadius = senseRadius;
    if (id === null) this.ring.visible = this.senseRing.visible = false;
  }

  /** Interpolated world position (with terrain height) of an agent in the current snapshot. */
  getAgentPosition(id: number, out: Vector3): boolean {
    const { cur, prev, hasPrev } = this.bridge;
    const o = cur.index.get(id);
    if (o === undefined || !cur.buffer) return false;
    let x = cur.buffer[o + SNAP_X];
    let z = cur.buffer[o + SNAP_Z];
    const po = hasPrev ? prev.index.get(id) : undefined;
    if (po !== undefined && prev.buffer) {
      const px = prev.buffer[po + SNAP_X];
      const pz = prev.buffer[po + SNAP_Z];
      x = px + (x - px) * this.lastAlpha;
      z = pz + (z - pz) * this.lastAlpha;
    }
    out.set(x, heightAt(x, z), z);
    return true;
  }

  update(nowMs: number) {
    const bridge = this.bridge;
    const { cur, prev, hasPrev, born } = bridge;
    const a = bridge.alpha(nowMs);
    this.lastAlpha = a;
    for (const s of this.species) s.count = 0;
    const buf = cur.buffer;
    if (buf) {
      const pbuf = prev.buffer;
      const prevIndex = prev.index;
      const t = nowMs * 0.001;
      const scaleInMs = RENDER.scaleInSeconds * 1000;
      const useBorn = born.size > 0;
      const species = this.species;
      for (let i = 0; i < cur.count; i++) {
        const o = i * SNAP_STRIDE;
        const id = buf[o + SNAP_ID];
        const s = species[buf[o + SNAP_SPECIES] | 0];
        if (!s || s.count >= MAX_AGENTS) continue;
        const n = s.count++;
        s.ids[n] = id;

        let x = buf[o + SNAP_X];
        let z = buf[o + SNAP_Z];
        let heading = buf[o + SNAP_HEADING];
        let size = buf[o + SNAP_SIZE];
        let moving = false;
        const po = hasPrev && pbuf ? prevIndex.get(id) : undefined;
        if (po !== undefined && pbuf) {
          const px = pbuf[po + SNAP_X];
          const pz = pbuf[po + SNAP_Z];
          const dx = x - px;
          const dz = z - pz;
          moving = dx * dx + dz * dz > 1e-5;
          x = px + dx * a;
          z = pz + dz * a;
          let dh = heading - pbuf[po + SNAP_HEADING];
          if (dh > Math.PI) dh -= TWO_PI;
          else if (dh < -Math.PI) dh += TWO_PI;
          heading = pbuf[po + SNAP_HEADING] + dh * a;
          const ps = pbuf[po + SNAP_SIZE];
          size = ps + (size - ps) * a;
        }

        let scale = size * RENDER.creatureBaseScale;
        if (useBorn) {
          const bt = born.get(id);
          if (bt !== undefined) {
            const k = (nowMs - bt) / scaleInMs;
            if (k < 1) scale *= k < 0 ? 0 : k * (2 - k);
          }
        }
        const y = heightAt(x, z) + RENDER.creatureLift + (moving ? Math.abs(Math.sin(t * RENDER.bobFrequency + id)) * RENDER.bobAmplitude * scale : 0);

        // Rotation about Y by -heading, uniform scale, written straight into the instance buffer.
        const m = s.mesh.instanceMatrix.array as Float32Array;
        const c = Math.cos(heading) * scale;
        const sn = Math.sin(heading) * scale;
        const k = n * 16;
        m[k] = c;
        m[k + 1] = 0;
        m[k + 2] = sn;
        m[k + 3] = 0;
        m[k + 4] = 0;
        m[k + 5] = scale;
        m[k + 6] = 0;
        m[k + 7] = 0;
        m[k + 8] = -sn;
        m[k + 9] = 0;
        m[k + 10] = c;
        m[k + 11] = 0;
        m[k + 12] = x;
        m[k + 13] = y;
        m[k + 14] = z;
        m[k + 15] = 1;

        // Color: palette jitter, darker when hungry, brighter fleeing, redder hunting.
        const e = buf[o + SNAP_ENERGY];
        const dark = RENDER.hungryDarken + (1 - RENDER.hungryDarken) * (e < 0 ? 0 : e > 1 ? 1 : e);
        const pi = (id % PALETTE) * 3;
        let r = s.palette[pi] * dark;
        let g = s.palette[pi + 1] * dark;
        let b = s.palette[pi + 2] * dark;
        const st = buf[o + SNAP_STATE];
        if (st === AgentState.FLEE) {
          r *= RENDER.fleeBrighten;
          g *= RENDER.fleeBrighten;
          b *= RENDER.fleeBrighten;
        } else if (st === AgentState.HUNT) {
          r += (1 - r) * RENDER.huntRedShift;
          g *= 1 - RENDER.huntRedShift;
          b *= 1 - RENDER.huntRedShift;
        }
        const ca = s.mesh.instanceColor!.array as Float32Array;
        const ci = n * 3;
        ca[ci] = r;
        ca[ci + 1] = g;
        ca[ci + 2] = b;
      }
    }

    for (const s of this.species) {
      const { mesh, count } = s;
      mesh.count = count;
      if (count === 0) continue;
      const ic = mesh.instanceColor!;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, count * 3);
      ic.needsUpdate = true;
    }

    this.updateSelection();
  }

  private selPos = new Vector3();
  private updateSelection() {
    if (this.selectedId === null || !this.getAgentPosition(this.selectedId, this.selPos)) {
      this.ring.visible = this.senseRing.visible = false;
      return;
    }
    const o = this.bridge.cur.index.get(this.selectedId)!;
    const size = this.bridge.cur.buffer![o + SNAP_SIZE];
    const r = size * RENDER.creatureBaseScale * RENDER.selectionRingScale;
    this.ring.visible = true;
    this.ring.position.set(this.selPos.x, this.selPos.y + RENDER.ringLift, this.selPos.z);
    this.ring.scale.setScalar(r);
    const showSense = this.showSense && this.senseRadius > 0;
    this.senseRing.visible = showSense;
    if (showSense) {
      this.senseRing.position.copy(this.ring.position);
      this.senseRing.scale.setScalar(this.senseRadius);
    }
  }
}
