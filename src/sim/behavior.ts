// Perception, decision and steering (spec §7.1 / §7.2). Allocation-free in the hot loop.
import { DECISION_EVERY, SIM, SIM_DT } from '../config';
import { AgentState } from '../shared/types';
import type { SimParams } from '../shared/types';
import type { Rng } from '../shared/rng';
import type { Agents, Diets } from './agents';
import { capacity } from './genome';
import type { SpatialHash } from './spatialHash';
import type { World } from './world';

const TWO_PI = Math.PI * 2;

export class Behavior {
  private readonly size: number;
  // Precomputed avoidance rotations.
  private readonly avCos: Float64Array;
  private readonly avSin: Float64Array;
  // Scratch results (avoid per-call allocations).
  private bestCell = -1;
  private bestScore = 0;
  private bestFood = 0;
  private bestDist = 0;
  private outX = 0;
  private outZ = 0;

  constructor(
    private readonly world: World,
    private readonly a: Agents,
    private readonly hash: SpatialHash,
    private readonly diets: Diets,
    private readonly rng: Rng,
  ) {
    this.size = world.size;
    this.avCos = Float64Array.from(SIM.avoidAngles, Math.cos);
    this.avSin = Float64Array.from(SIM.avoidAngles, Math.sin);
  }

  update(tick: number, p: SimParams, food: Float32Array): void {
    const a = this.a;
    const n = a.count;
    const phase = tick % DECISION_EVERY;
    for (let i = 0; i < n; i++) {
      if (a.id[i] % DECISION_EVERY === phase) this.decide(i, p, food);
      this.steer(i, p);
    }
  }

  // ---------- perception + decision ----------
  private decide(i: number, p: SimParams, food: Float32Array): void {
    const a = this.a;
    const diets = this.diets;
    const hash = this.hash;
    const sp = a.species[i];
    const x = a.x[i];
    const z = a.z[i];
    const sense = a.sense[i];
    const size = a.size[i];
    const fleeR = sense * (0.4 + 0.6 * a.fear[i]);
    const fleeR2 = fleeR * fleeR;
    const sense2 = sense * sense;
    const sepR = p.separationRadius;
    const sepR2 = sepR * sepR;
    const scanR = Math.max(sense, sepR);
    const scanR2 = scanR * scanR;
    const threatMask = diets.threatMask[sp];
    const preyMask = diets.preyMask[sp];

    let tx = 0;
    let tz = 0;
    let tw = 0;
    let sx = 0;
    let sz = 0;
    let bestPrey = -1;
    let bestD2 = Infinity;

    hash.setRange(x, z, scanR);
    const { gw, cellStart, cellCount, sortedIndices } = hash;
    for (let bz = hash.bz0; bz <= hash.bz1; bz++) {
      for (let bx = hash.bx0; bx <= hash.bx1; bx++) {
        const c = bz * gw + bx;
        const s = cellStart[c];
        const e = s + cellCount[c];
        for (let k = s; k < e; k++) {
          const j = sortedIndices[k];
          if (j === i) continue;
          const dx = a.x[j] - x;
          const dz = a.z[j] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 > scanR2) continue;
          const sj = a.species[j];
          if (sj === sp) {
            if (d2 < sepR2 && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const w = (1 - d / sepR) / d;
              sx -= dx * w;
              sz -= dz * w;
            }
            continue;
          }
          if (((threatMask >> sj) & 1) !== 0 && d2 <= fleeR2 && diets.canKill(p, sj, a.size[j], sp, size)) {
            const w = 1 / (d2 + 0.25);
            tx += dx * w;
            tz += dz * w;
            tw += w;
          }
          if (((preyMask >> sj) & 1) !== 0 && d2 < bestD2 && d2 <= sense2 && diets.canKill(p, sp, size, sj, a.size[j])) {
            bestD2 = d2;
            bestPrey = j;
          }
        }
      }
    }
    a.sepX[i] = sx;
    a.sepZ[i] = sz;

    // Still running from a lost fight.
    if (a.fleeTimer[i] > 0) return;

    if (tw > 0) {
      let fx = -tx / tw;
      let fz = -tz / tw;
      const len = Math.sqrt(fx * fx + fz * fz);
      if (len > 1e-6) {
        fx /= len;
        fz /= len;
      } else {
        fx = Math.cos(a.wander[i]);
        fz = Math.sin(a.wander[i]);
      }
      a.fleeX[i] = fx;
      a.fleeZ[i] = fz;
      a.state[i] = AgentState.FLEE;
      a.targetId[i] = 0;
      return;
    }

    const cap = capacity(size, p);
    const ratio = a.energy[i] / cap;
    const hungry = ratio < p.hungerThreshold;
    const wasHunting = a.state[i] === AgentState.HUNT;

    let hunt = false;
    if (bestPrey >= 0) {
      if (hungry) hunt = true;
      else if (ratio < SIM.satiatedRatio) {
        // Aggression is a per-second urge; decisions run DECISION_EVERY ticks apart.
        let chance = a.aggression[i] * SIM.huntRollScale * DECISION_EVERY * SIM_DT;
        if (wasHunting && chance < SIM.huntPersist) chance = SIM.huntPersist;
        hunt = this.rng.next() < chance;
      }
    }

    let graze = false;
    if (diets.plants[sp] === 1 && hungry) {
      this.findFood(i, food);
      graze = this.bestCell >= 0;
    }

    if (hunt && graze) {
      // Omnivore: expected energy per distance.
      const sj = a.size[bestPrey];
      const huntScore = (p.meatEnergy * sj * sj * p.meatEfficiency) / (1 + Math.sqrt(bestD2));
      const grazeScore = (p.plantEnergy * this.bestFood) / (1 + this.bestDist);
      if (grazeScore > huntScore) hunt = false;
    }

    if (hunt) {
      a.state[i] = AgentState.HUNT;
      a.targetId[i] = a.id[bestPrey];
      a.targetIdx[i] = bestPrey;
    } else if (graze) {
      a.state[i] = AgentState.GRAZE;
      a.targetCell[i] = this.bestCell;
      a.targetId[i] = 0;
    } else if (ratio > a.fertility[i] && a.reproCd[i] <= 0) {
      a.state[i] = AgentState.REPRODUCE;
      a.targetId[i] = 0;
    } else {
      a.state[i] = AgentState.WANDER;
      a.targetId[i] = 0;
    }
  }

  /** Samples a bounded number of cells within sense (plus current + previous target); result in best* fields. */
  private findFood(i: number, food: Float32Array): void {
    const a = this.a;
    const x = a.x[i];
    const z = a.z[i];
    const sense = a.sense[i];
    this.bestCell = -1;
    this.bestScore = 0;
    const c0 = (z | 0) * this.size + (x | 0);
    this.evalFood(c0, food[c0], 0);
    const prev = a.targetCell[i];
    if (prev >= 0) {
      const dx = (prev % this.size) + 0.5 - x;
      const dz = ((prev / this.size) | 0) + 0.5 - z;
      this.evalFood(prev, food[prev], Math.sqrt(dx * dx + dz * dz));
    }
    const rng = this.rng;
    for (let s = 0; s < SIM.foodSamples; s++) {
      const ang = rng.next() * TWO_PI;
      const r = sense * Math.sqrt(rng.next());
      const px = x + Math.cos(ang) * r;
      const pz = z + Math.sin(ang) * r;
      if (!this.world.isLand(px, pz)) continue;
      const c = (pz | 0) * this.size + (px | 0);
      this.evalFood(c, food[c], r);
    }
  }

  private evalFood(cell: number, f: number, dist: number): void {
    if (f < SIM.foodMinValue) return;
    const score = f / (1 + dist * SIM.foodDistWeight);
    if (score > this.bestScore) {
      this.bestScore = score;
      this.bestCell = cell;
      this.bestFood = f;
      this.bestDist = dist;
    }
  }

  // ---------- steering + movement ----------
  private steer(i: number, p: SimParams): void {
    const a = this.a;
    const x = a.x[i];
    const z = a.z[i];
    const maxSpeed = a.speed[i];
    let dirX = 0;
    let dirZ = 0;
    let spd = 0;

    switch (a.state[i]) {
      case AgentState.HUNT:
      case AgentState.FIGHT: {
        const j = a.indexOf(a.targetId[i], a.targetIdx[i]);
        if (j < 0) {
          a.targetId[i] = 0;
          a.state[i] = AgentState.WANDER;
          break;
        }
        a.targetIdx[i] = j;
        const dx = a.x[j] - x;
        const dz = a.z[j] - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        // Lead targeting: aim where the prey will be.
        const t = Math.min(d / maxSpeed, SIM.leadTimeMax);
        const lx = dx + a.vx[j] * t;
        const lz = dz + a.vz[j] * t;
        const ll = Math.sqrt(lx * lx + lz * lz);
        if (ll > 1e-6) {
          dirX = lx / ll;
          dirZ = lz / ll;
          spd = maxSpeed * (a.state[i] === AgentState.FIGHT ? SIM.fightSpeedFactor : 1);
        }
        break;
      }
      case AgentState.FLEE:
        dirX = a.fleeX[i];
        dirZ = a.fleeZ[i];
        spd = maxSpeed;
        break;
      case AgentState.GRAZE: {
        const cell = a.targetCell[i];
        const dx = (cell % this.size) + 0.5 - x;
        const dz = ((cell / this.size) | 0) + 0.5 - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > SIM.arriveDistance) {
          dirX = dx / d;
          dirZ = dz / d;
          spd = maxSpeed * SIM.grazeSpeedFactor;
        }
        break;
      }
      default: {
        // WANDER / REPRODUCE: smoothed random heading.
        const ang = a.wander[i] + (this.rng.next() - 0.5) * 2 * SIM.wanderTurnRate * SIM_DT;
        a.wander[i] = ang;
        dirX = Math.cos(ang);
        dirZ = Math.sin(ang);
        spd = maxSpeed * (a.state[i] === AgentState.WANDER ? p.wanderSpeedFactor : SIM.reproSpeedFactor);
      }
    }

    // Water / edge avoidance: probe ahead and rotate away if blocked.
    if (spd > 0) {
      this.clearDir(x, z, dirX, dirZ, a.id[i]);
      if (this.outX !== dirX || this.outZ !== dirZ) {
        dirX = this.outX;
        dirZ = this.outZ;
        a.wander[i] = Math.atan2(dirZ, dirX);
      }
    }

    // Desired velocity + separation, clamped to max speed.
    let dvx = dirX * spd + a.sepX[i] * p.separationStrength;
    let dvz = dirZ * spd + a.sepZ[i] * p.separationStrength;
    const dm = Math.sqrt(dvx * dvx + dvz * dvz);
    if (dm > maxSpeed) {
      dvx *= maxSpeed / dm;
      dvz *= maxSpeed / dm;
    }

    // Accel-limited velocity change.
    let vx = a.vx[i];
    let vz = a.vz[i];
    let ax = dvx - vx;
    let az = dvz - vz;
    const maxDv = p.steerAccel * maxSpeed * SIM_DT;
    const am = Math.sqrt(ax * ax + az * az);
    if (am > maxDv) {
      ax *= maxDv / am;
      az *= maxDv / am;
    }
    vx += ax;
    vz += az;
    const vm = Math.sqrt(vx * vx + vz * vz);
    if (vm > maxSpeed) {
      vx *= maxSpeed / vm;
      vz *= maxSpeed / vm;
    }

    // Integrate with collision (slide along water / edges).
    let nx = Math.fround(x + vx * SIM_DT); // fround: positions are Float32, check what will be stored
    let nz = Math.fround(z + vz * SIM_DT);
    const w = this.world;
    if (!w.isLand(nx, nz)) {
      if (w.isLand(nx, z)) {
        nz = z;
        vz *= -SIM.bounce;
      } else if (w.isLand(x, nz)) {
        nx = x;
        vx *= -SIM.bounce;
      } else {
        nx = x;
        nz = z;
        vx = -vx * SIM.bounce;
        vz = -vz * SIM.bounce;
      }
    }
    a.x[i] = nx;
    a.z[i] = nz;
    a.vx[i] = vx;
    a.vz[i] = vz;
    if (vx * vx + vz * vz > SIM.minHeadingSpeed * SIM.minHeadingSpeed) a.heading[i] = Math.atan2(vz, vx);
  }

  /** Writes a land-facing direction near (dx, dz) into outX/outZ. */
  private clearDir(x: number, z: number, dx: number, dz: number, id: number): void {
    const la = SIM.lookahead;
    const flip = (id & 1) === 0 ? 1 : -1;
    for (let k = 0; k < this.avCos.length; k++) {
      const c = this.avCos[k];
      const s = this.avSin[k] * flip;
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      if (this.world.isLand(x + rx * la, z + rz * la)) {
        this.outX = k === 0 ? dx : rx;
        this.outZ = k === 0 ? dz : rz;
        return;
      }
    }
    this.outX = -dx;
    this.outZ = -dz;
  }
}
