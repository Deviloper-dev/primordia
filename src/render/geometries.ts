// Low-poly creature bodies. Convention: +X is "forward", +Y up, origin at the feet (y = 0 on the ground).
// Rotate instances about Y by -heading (heading = atan2(vz, vx)).
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  SphereGeometry,
  TetrahedronGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Archetype } from '../shared/types';

/** Strip to position+normal, non-indexed, so parts can be merged. */
function part(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  return out;
}

function grazer(): BufferGeometry {
  const body = part(new SphereGeometry(0.4, 8, 6));
  body.scale(1.15, 0.9, 0.9);
  body.translate(0, 0.4, 0);
  const head = part(new ConeGeometry(0.22, 0.45, 6));
  head.rotateZ(-Math.PI / 2); // tip toward +X
  head.translate(0.55, 0.5, 0);
  return mergeGeometries([body, head])!;
}

function hunter(): BufferGeometry {
  const body = part(new ConeGeometry(0.36, 1.3, 6));
  body.rotateZ(-Math.PI / 2);
  body.translate(0.1, 0.36, 0);
  return body;
}

function tank(): BufferGeometry {
  const body = part(new BoxGeometry(1, 0.55, 0.8));
  body.translate(0, 0.3, 0);
  const head = part(new BoxGeometry(0.3, 0.3, 0.45));
  head.translate(0.6, 0.35, 0);
  return mergeGeometries([body, head])!;
}

function swarmer(): BufferGeometry {
  const g = part(new TetrahedronGeometry(0.5));
  // Put one vertex toward +X and lift it onto the ground.
  g.rotateZ(Math.PI / 4 + 0.2);
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox!.min.y, 0);
  return g;
}

export function createArchetypeGeometry(a: Archetype): BufferGeometry {
  switch (a) {
    case 'grazer':
      return grazer();
    case 'hunter':
      return hunter();
    case 'tank':
      return tank();
    case 'swarmer':
      return swarmer();
  }
}
