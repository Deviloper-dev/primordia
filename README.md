# Primordia

A Game-of-Life-inspired 3D evolving ecosystem running in your browser. Watch as food spreads across terrain, creatures graze and hunt, and ecosystems evolve before your eyes. Built with Three.js rendering, Web Worker simulation, and fully deterministic, shareable runs via URL seed.

## What It Is

Primordia simulates a living world on a 2–4-species food web. The environment is a cellular automaton where plant food grows, spreads, and gets eaten, then regrows. Creatures move, forage, hunt, flee, fight, reproduce, and die — all driven by evolvable genomes with mutation and energy trade-offs.

**How it works:**
- **Food CA:** Plant food grows logistically, sprouts in dense regions (Game-of-Life style), and dies out in barren areas; creatures eat it and leave corpses that fertilize the ground.
- **Energy model:** Movement and sensory range cost energy proportional to body size and speed. Creatures must feed to survive.
- **Evolution:** Each creature inherits a mutated genome from its parent (size, speed, sense range, aggression, fear, etc.). Trade-offs between traits produce emergent niches — fast small herbivores, slow strong herbivores, lean hunters, etc.
- **Behavior:** Creatures perceive threats and prey within range, then decide to wander, graze, hunt, flee, or reproduce based on hunger and opportunity.

## Presets

Four configurations ship by default, each with different food webs and dynamics:

- **Classic:** Three-level food chain. Grazers eat plants; Hunters chase Grazers; Omnivores eat plants and small Grazers (size-based).
- **Rock–Paper–Scissors:** Three species that eat plants and form a cycle: Red hunts Blue, Blue hunts Green, Green hunts Red. Creates spatial waves.
- **Four Kingdoms:** Herbivores (fast Hoppers + slow Bulks) form the base; Stalkers hunt both; Apex predators hunt Stalkers. Multi-level hierarchy.
- **Duel:** Two herbivores (Ochre and Teal) compete purely for plants. Simplest setup; reveals plant dynamics and competition.

## Controls

| Action | Control |
|--------|---------|
| **Orbit camera** | Left-drag |
| **Pan camera** | Right-drag |
| **Zoom** | Scroll wheel |
| **Select/inspect creature** | Click |
| **Spawn with brush** | Shift+click terrain (or toggle brush mode in panel) |
| **Play/pause** | Space |
| **Step one tick** | `.` (period) |
| **Reset** | R |
| **Follow selected** | F |
| **Deselect** | Esc |

**Panel sections:** Simulation (play/pause, speed, preset, seed); Species (diet, genomes); Environment (growth rates, water level); Evolution (mutation, costs); Brush (spawn tool); View (display options).

## Run End: Over-population

To keep things smooth, each species has a population cap (**pop cap / species** in the Simulation panel, default 4,000; set to 0 to disable). When any species reaches it, the simulation pauses and shows which species took over the world, its population, and how long it took (sim time and ticks). Choose **Continue (cap off)** to keep watching or **Reset** to start a new run.

## Shareable Runs

The URL hash encodes the seed and preset, making runs fully reproducible:

```
https://yoursite.com/primordia#seed=1234&preset=classic
```

With the same seed, preset, and no user interaction, the simulation unfolds identically every time. Preset IDs: `classic`, `rps`, `fourKingdoms`, `duel`.

## Run Locally

**Requirements:** Node 20+

```bash
npm install
npm run dev         # Start dev server
npm run build       # Build for production
npm run preview     # Preview production build
npm run tune        # Run headless tuning script for balancing
```

## Deploy

Push to the `main` branch and GitHub Actions will deploy to GitHub Pages. In your repo Settings → Pages, ensure:
- **Source:** GitHub Actions

Vite is configured with `base: './'` so the app works under repo subpaths.

## Project Structure

```
src/
  shared/    Types, RNG, and message schemas
  sim/       Worker logic: world generation, food CA, agents, behavior, interactions, stats
  render/    Three.js scene, terrain, creatures, picking, interpolation
  ui/        Panels, charts, inspector, HUD
```

All tunables live in `src/config.ts` — simulation constants, species presets, rendering parameters, UI settings. Never hard-code balancing numbers.
