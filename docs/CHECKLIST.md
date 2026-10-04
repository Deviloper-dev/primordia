# Primordia — Implementation Checklist

Source of truth: [primordia-spec.md](./primordia-spec.md). Update as tasks land.

## 1. Foundation (main agent)
- [x] Vite + TS scaffold, package.json, tsconfig (strict), vite.config (`base: './'`)
- [x] Deploy: Cloudflare Git integration + `wrangler.jsonc` static assets (GitHub Pages unavailable: private repo on free plan; GH Actions workflow removed)
- [x] First Cloudflare deploy live at https://primordia.deviloper.dev/
- [x] `src/config.ts` — all tunables + 4 presets
- [x] `src/shared/types.ts`, `messages.ts`, `rng.ts` (contracts)

## 2. Simulation — worker (Sonnet subagent)
- [x] `sim/world.ts` terrain (height, water ~12%, fertility)
- [x] `sim/environment.ts` food CA (growth, GoL birth, seeding, corpses, double buffer)
- [x] `sim/agents.ts` SoA store, free list, monotonic ids, snapshot writer
- [x] `sim/genome.ts` mutation + cost functions
- [x] `sim/spatialHash.ts` counting-sort buckets, no per-tick alloc
- [x] `sim/behavior.ts` perception, decision (staggered), steering, avoidance, separation
- [x] `sim/interactions.ts` eating, combat, reproduction, death
- [x] `sim/stats.ts`
- [x] `sim/simulation.ts` headless `Simulation` class
- [x] `sim/worker.ts` message router, fixed-step loop, ping-pong buffers

## 3. Client — render + UI (Sonnet subagent)
- [x] `bridge.ts` SimBridge + snapshot interpolation
- [x] `render/scene.ts`, `terrain.ts` (food DataTexture shader), `geometries.ts`, `creatures.ts`, `picking.ts`
- [x] `ui/panel.ts` (lil-gui, live diet matrix, add/remove species), `chart.ts`, `inspector.ts`, `hud.ts`
- [x] Follow cam (F), brush (shift+click), keyboard (Space, `.`, R), URL hash seed/preset, extinction toast
- [x] `main.ts` bootstrap

## 4. Integration & verification (main agent)
- [x] `npm run build` — zero TS errors
- [x] `npm run dev` runs; browser smoke test

## 5. Tuning pass §11 (Sonnet subagent)
- [x] `scripts/tune.ts` headless runner (`npm run tune -- --seeds 1,2,3 --minutes 12`; exploration flags `--set/--gen/--count/--sim`)
- [x] Classic: all 3 alive at 10 min in 15/20 held-out seeds (11–30) and 3/5 on seeds 1–5; oscillation + trait drift (grazer speed 4.7→6.5). Key fix: satiated predators no longer surplus-kill (per-second aggression roll + `SIM.satiatedRatio`); slow, long-lived Hunters.
- [x] Other presets sanity: RPS stable; Duel → Teal loses to Ochre (competitive exclusion, by design)
- [x] Four Kingdoms pass 1: Apex now eats Bulks + Stalkers; Hoppers slowed 6→4.5 (Stalkers couldn't catch them → Hopper boom → famine); Bulks fear 0.3→0; Stalkers/Apex slow-breeding + long-lived. Hoppers/Bulks/Stalkers now survive 10 min in 5/6 seeds.
- [x] (Accepted 2026-10-04 as "Apex invader" story, documented in README) Four Kingdoms: Apex still dies at 235–520 s (was ~90 s). Tried: slower/smaller Apex, more Apex, generalist Apex (worse — out-competes Stalkers). Likely needs larger Stalker population or accepting Apex as a transient.
  - 2026-10-04 diagnosis: Apex itself is at replacement (births≈deaths, energy ~0.6) until Stalkers collapse; Stalkers barely break even (Hopper meal ≈25 energy ≈13 s of chase) and Apex predation tips them over → Hoppers boom → famine kills Bulks → Apex starves.
  - Tried & failed: more Stalkers (worse — overshoot), Apex eats only Bulks, cheaper Stalkers/bigger Hoppers (fixes Stalkers, kills Bulks), 40-config random search (best 2/12 all-alive on held-out seeds; Apex dies 9–12/12). Needs a structural decision, not more tuning.
- [ ] Real-GPU perf check at 5k agents (only headless SwiftShader measured)

## 6. Docs
- [x] README (what, controls, run locally, Pages setup)

## 7. User additions
- [x] Per-species population cap (`params.popCap`, default 4000, 0 = off, live slider in Simulation). Reaching it pauses the worker and shows an "over-population" end card (species, count, sim time, ticks) with Continue (cap off) / Reset. Verified in headless Chrome.
- [x] Control panel show/hide button (top-right) + H shortcut; auto-hidden on screens < 700px; state survives rebuilds. Fixed lil-gui 0.21 class names (`.lil-root`) so panel CSS actually applies.
