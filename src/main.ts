import './style.css';
import { Vector3 } from 'three';
import { SimBridge } from './bridge';
import {
  DEFAULT_PARAMS,
  DEFAULT_PRESET,
  DEFAULT_WORLD_SIZE,
  MAX_SPECIES,
  MIN_SPECIES,
  PRESETS,
  RENDER,
  UI,
  clonePresetSpecies,
  newSpeciesTemplate,
} from './config';
import { Creatures } from './render/creatures';
import { Picker } from './render/picking';
import { SceneContext } from './render/scene';
import { Terrain, randomLandPoint } from './render/terrain';
import { randomSeed } from './shared/rng';
import type { PresetId, SelectedAgentInfo } from './shared/types';
import { Charts } from './ui/chart';
import { Hud } from './ui/hud';
import { Inspector } from './ui/inspector';
import { Outcome } from './ui/outcome';
import { Panel } from './ui/panel';
import type { AppState } from './ui/panel';

// ---------- initial state (URL hash: #seed=1234&preset=classic) ----------
function readHash(): { seed: number; preset: PresetId } {
  const q = new URLSearchParams(location.hash.slice(1));
  const seed = Number.parseInt(q.get('seed') ?? '', 10);
  const p = q.get('preset') as PresetId | null;
  return {
    seed: Number.isFinite(seed) && seed >= 0 ? seed : randomSeed(),
    preset: p && p in PRESETS ? p : DEFAULT_PRESET,
  };
}

const hash = readHash();
const state: AppState = {
  seed: hash.seed,
  preset: hash.preset,
  worldSize: DEFAULT_WORLD_SIZE,
  species: clonePresetSpecies(hash.preset),
  params: { ...DEFAULT_PARAMS },
  paused: false,
  speed: 1,
  brush: { species: 0, count: UI.brushDefaultCount, radius: UI.brushDefaultRadius, mode: false },
  view: { shadows: false, foodOverlay: true, senseRadius: true, charts: true },
};

// ---------- DOM + rendering ----------
const app = document.getElementById('app')!;
const canvasHost = document.createElement('div');
canvasHost.className = 'canvas-host';
const uiLayer = document.createElement('div');
uiLayer.className = 'ui-layer';
app.append(canvasHost, uiLayer);

const sceneCtx = new SceneContext(canvasHost);
const terrain = new Terrain();
sceneCtx.scene.add(terrain.group);

let selectedId: number | null = null;
let following = false;

const bridge = new SimBridge({
  onWorld(msg) {
    state.worldSize = msg.size;
    terrain.build(msg.size, msg.height, msg.water, msg.fertility, msg.waterHeight);
    terrain.setOverlay(state.view.foodOverlay);
    sceneCtx.frameWorld(msg.size);
  },
  onFood: (buf) => terrain.setFood(buf),
  onStats(stats) {
    charts.push(stats);
    hud.onStats(stats);
    inspector.setAverages(stats.avgTraits);
  },
  onEnded(end) {
    // Worker has already paused itself.
    state.paused = true;
    panel.refresh();
    outcome.show(end, state.species);
  },
  onSelected(info: SelectedAgentInfo | null) {
    if (info === null) {
      if (selectedId !== null) deselect();
      return;
    }
    if (info.id !== selectedId) return; // stale message after re-selecting
    inspector.show(info);
    if (info.alive) {
      creatures.setSelection(info.id, info.genome.sense);
    } else {
      creatures.setSelection(null, 0); // agent is gone; keep the card
      setFollow(false);
    }
  },
});

const creatures = new Creatures(bridge);
sceneCtx.scene.add(creatures.group);
const picker = new Picker(sceneCtx.camera, sceneCtx.renderer.domElement, creatures, terrain);

const hud = new Hud(uiLayer);
const outcome = new Outcome(
  uiLayer,
  () => {
    // Keep watching past the cap: disable it for this run, then resume.
    state.params.popCap = 0;
    bridge.setParams({ popCap: 0 });
    outcome.hide();
    setPaused(false);
  },
  () => startWorld(false),
);
const charts = new Charts(uiLayer);
const inspector = new Inspector(uiLayer, () => setFollow(!following), () => deselect());

// ---------- selection / follow ----------
function select(id: number) {
  selectedId = id;
  bridge.select(id);
  creatures.setSelection(id, 0);
}

function deselect() {
  selectedId = null;
  bridge.select(null);
  creatures.setSelection(null, 0);
  inspector.hide();
  setFollow(false);
}

function setFollow(on: boolean) {
  following = on && selectedId !== null;
  inspector.setFollowing(following);
}

// ---------- simulation control ----------
function updateHash() {
  history.replaceState(null, '', `#seed=${state.seed}&preset=${state.preset}`);
}

function syncRenderersToSpecies() {
  creatures.setSpecies(state.species);
  creatures.setCastShadow(state.view.shadows);
  charts.setSpecies(state.species);
  hud.setSpecies(state.species);
  inspector.setSpecies(state.species);
}

function startWorld(initial: boolean) {
  const setup = {
    seed: state.seed,
    preset: state.preset,
    worldSize: state.worldSize,
    species: state.species,
    params: state.params,
  };
  if (initial) bridge.init(setup);
  else bridge.reset(setup);
  bridge.setSpeed(state.speed);
  bridge.setPaused(state.paused);
  if (selectedId !== null) deselect();
  syncRenderersToSpecies();
  charts.clear();
  hud.reset();
  outcome.hide();
  updateHash();
  panel.rebuild();
}

function setPaused(p: boolean) {
  state.paused = p;
  bridge.setPaused(p);
  panel.refresh();
}

function removeSpecies(i: number) {
  if (state.species.length <= MIN_SPECIES) return;
  state.species.splice(i, 1);
  for (const sp of state.species) {
    sp.diet.eats = sp.diet.eats.filter((e) => e !== i).map((e) => (e > i ? e - 1 : e));
  }
  startWorld(false);
}

const panel: Panel = new Panel(state, {
  onPause: setPaused,
  onStep: () => bridge.step(),
  onSpeed: (v) => bridge.setSpeed(v),
  onReset: () => startWorld(false),
  onRandomSeed() {
    state.seed = randomSeed();
    startWorld(false);
  },
  onPreset(id) {
    state.preset = id;
    state.species = clonePresetSpecies(id);
    startWorld(false);
  },
  onParams: (p) => bridge.setParams(p),
  onSpeciesEdit() {
    bridge.setSpecies(state.species);
    syncRenderersToSpecies();
  },
  onAddSpecies() {
    if (state.species.length >= MAX_SPECIES) return;
    state.species.push(newSpeciesTemplate(state.species.length));
    startWorld(false);
  },
  onRemoveSpecies: removeSpecies,
  onSpawnRandom(i) {
    const [x, z] = randomLandPoint();
    bridge.spawn(i, x, z, UI.spawnRandomCount, UI.spawnRandomRadius);
  },
  onView() {
    sceneCtx.setShadows(state.view.shadows);
    creatures.setCastShadow(state.view.shadows);
    terrain.setOverlay(state.view.foodOverlay);
    creatures.showSense = state.view.senseRadius;
    charts.setVisible(state.view.charts);
  },
});

// ---------- input ----------
const dom = sceneCtx.renderer.domElement;
let down: { x: number; y: number } | null = null;
dom.addEventListener('pointerdown', (e) => {
  down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
});
dom.addEventListener('pointerup', (e) => {
  if (!down || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved >= UI.clickMaxMovePx) return;
  if (e.shiftKey || state.brush.mode) {
    const p = picker.pickTerrain(e.clientX, e.clientY);
    if (p) bridge.spawn(state.brush.species, p[0], p[1], state.brush.count, state.brush.radius);
  } else {
    const id = picker.pickAgent(e.clientX, e.clientY);
    if (id !== null) select(id);
    else if (selectedId !== null) deselect();
  }
});

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      setPaused(!state.paused);
      break;
    case '.':
      bridge.step();
      break;
    case 'r':
    case 'R':
      startWorld(false);
      break;
    case 'f':
    case 'F':
      setFollow(!following);
      break;
    case 'Escape':
      deselect();
      break;
  }
});

// ---------- boot ----------
creatures.showSense = state.view.senseRadius;
startWorld(true);
inspector.setFollowing(false);

const tmp = new Vector3();
const delta = new Vector3();
let fps = 60;
let last = performance.now();

function frame() {
  const now = performance.now();
  const dt = now - last;
  last = now;
  if (dt > 0) fps += (1000 / dt - fps) * 0.05;

  creatures.update(now);

  if (following && selectedId !== null && creatures.getAgentPosition(selectedId, tmp)) {
    delta.copy(tmp).sub(sceneCtx.controls.target).multiplyScalar(RENDER.followLerp);
    sceneCtx.controls.target.add(delta);
    sceneCtx.camera.position.add(delta);
  }
  sceneCtx.controls.update();
  sceneCtx.render();

  if (bridge.cur.buffer) {
    hud.tick = bridge.cur.tick;
    hud.time = bridge.cur.time;
  }
  hud.update(now, fps, state.seed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
