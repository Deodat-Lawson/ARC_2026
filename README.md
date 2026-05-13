# ARC 2026

**A.R.C. — Autonomous Rescue Cluster.** A Gemma 4-powered post-disaster autonomous rescue swarm system. This repo is the marketing site for the project.

The site is being built around a 3D hero element showing a swarm of rescue drones flying through an earthquake-damaged urban environment, with one drone "detecting" a survivor under rubble. See the implementation plan at `~/.claude/plans/smart-pivot-that-s-sharded-backus.md`.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 (CSS-only config)
- React Three Fiber + Drei + Postprocessing
- Theatre.js (added in Week 3 for cinematic camera authoring)

## Getting started

```bash
pnpm install
pnpm dev
```

The dev server will run with primitive-block placeholder geometry — the GLB assets land later. Open http://localhost:3000 and you'll see:
- Blocky building stand-ins
- Four drones in V-formation with spinning rotors and blinking nav lights
- Drifting dust particles + haze sheets
- A green targeting bracket that appears at ~10s into the 12s loop

On mobile or low-core devices, the page renders a `<video>` fallback instead of the canvas. Until `public/hero-fallback.mp4` is generated, you'll see a blank video element.

## Project structure

```
app/
  layout.tsx          # Root layout, font, poster preload
  page.tsx            # Landing page (currently just <Hero />)
  globals.css         # Tailwind v4 + design tokens

components/
  hero/
    Hero.tsx          # Device-gate + Suspense boundary
    HeroCanvas.tsx    # <Canvas>, lighting, post-FX pipeline
    Scene.tsx         # Baked environment GLB (with primitive placeholder)
    DroneSwarm.tsx    # V-formation orchestration
    Drone.tsx         # Single drone (primitive placeholder)
    ParticleField.tsx # Sparkles + haze planes
    CameraRig.tsx     # CatmullRomCurve3 path, 12s loop
    DetectionHUD.tsx  # drei <Html> targeting bracket at t=10s
    HeroFallback.tsx  # <video> for mobile
  ui/
    HeroOverlay.tsx   # DOM overlay (headline, CTA, nav)

lib/
  useIsMobile.ts
  useReducedMotion.ts

public/
  models/             # GLBs land here (drop in once Blender exports)
  textures/           # KTX2 textures
  hdri/               # 2K HDRI for desktop reflections
  hero-fallback.mp4   # Mobile video loop
  hero-poster.webp    # LCP image
```

## Asset pipeline

### EAM165 (108 ruin pieces — converted, live)

7 of the 108 OBJ assets from `EAM165-灾难建筑车辆城市灾难废墟108件` were converted and are now live in the hero scene:

| Slug | Source | Final GLB |
|---|---|---|
| `building-apartment` | AM165_090 | 503 KB |
| `building-facade` | AM165_095 | 1.12 MB |
| `building-multistory` | AM165_100 | 994 KB |
| `building-mansion` | AM165_105 | 700 KB |
| `vehicle-taxi` | AM165_001 | 207 KB |
| `street-signs` | AM165_080 | 277 KB |
| `rubble-large` | AM165_060 | 40 KB |

Total: ~3.8 MB. Pipeline: OBJ → obj2gltf → gltf-transform weld → simplify (30–50% triangle reduction) → Draco compression. See [scripts/convert-assets.mjs](scripts/convert-assets.mjs).

The source OBJ MTL files reference only V-Ray procedural materials (no diffuse maps), so the converted GLBs come untextured. A procedural concrete `MeshStandardMaterial` is applied per-mesh in `Scene.tsx` with a tint variation. To add more assets:

1. Edit the `PICKS` array in `scripts/convert-assets.mjs`
2. Run `node scripts/convert-assets.mjs`
3. Add a placement to the `PLACEMENTS` array in `components/hero/Scene.tsx`

### KBS105 (KitBash3D Warzone2 / Aftermath — needs Blender)

The KBS105 kit is a single 663 MB monolithic FBX file. It can't be split automatically — you need Blender:

1. Open `KBS105-倒塌废墟战后街道楼房建筑/FBX/FBX/Kitbash3d_Warzone2.FBX` in Blender
2. Select individual buildings/groups in the outliner
3. For each: `File → Export → glTF 2.0 (.glb)` with "Selected Objects" checked
4. Drop the GLBs into `public/models/kbs105/`
5. Add new entries to the `PLACEMENTS` array in `Scene.tsx`

The KBS105 textures are PBR-ready (`KB3D_WZT_ConcreteA_basecolor.jpg`, normal, roughness, metallic — all standard maps). When exporting from Blender, embed materials and textures so they survive into the GLB. Then optionally run `gltf-transform uastc` to compress the textures.

## Swapping placeholders for real assets

The hero now uses real assets. Two flags remain:

- **`components/hero/Scene.tsx`** — set `USE_PRIMITIVES_FALLBACK = true` to bypass the GLBs and revert to procedural blocks (for emergency debugging).
- **`components/hero/Drone.tsx`** — replace the primitive body with `<primitive object={useGLTF("/models/drone-hero.glb").scene} />` once cleaned drone GLBs are exported.

For asset compression after Blender export:

```bash
# Compress geometry (Draco)
pnpm exec gltf-transform draco public/models/_raw/environment.glb public/models/environment.glb

# Compress textures (UASTC for hero quality)
pnpm exec gltf-transform uastc public/models/environment.glb public/models/environment.glb
```

Targets: `environment.glb` ≤ 2 MB, each drone GLB ≤ 300 KB.

## Performance budget

| Metric | Desktop | Mobile (video) |
|---|---|---|
| Wire bytes above the fold | ≤ 5 MB | ≤ 2.5 MB |
| FPS | 60 on M1 / RTX 3060 laptop | 60 (video) |
| Draw calls | ≤ 40 | n/a |
| LCP | ≤ 2.5s | ≤ 2.0s |

`<PerformanceMonitor>` in `HeroCanvas.tsx` will drop DPR from 1.5 → 1.0 automatically if FPS dips. Beyond that, cut particle count or post-FX manually.

## Asset sourcing

- **Environment:** [KitBash3D Aftermath](https://kitbash3d.com/products/aftermath) ($195) is the primary kit. Free alt for prototyping: [Sketchfab Post Apocalyptic Ruined City Pack (CC0)](https://sketchfab.com/3d-models/post-apocalyptic-ruined-city-pack-8f22e5807cff4969822d1dc231aa4261).
- **Drones (3 variants for variety):**
  - Hero: [Futuristic Stealth Quad Drone](https://sketchfab.com/3d-models/futuristic-stealth-quad-drone-5d9fc61b461c418fa41028f5c96a0ef8)
  - Mid: [Quad-copter Drone by tamescrawl2](https://sketchfab.com/3d-models/quad-copter-drone-4682a9d8cc5c4e6a82c7bff14f)
  - Background: [Low Poly QuadCopter](https://sketchfab.com/3d-models/low-poly-quadcopter-drone-fa0261d9db004dda9d4d3ff9bc985717)
  - All CC-Attribution — add credits in the footer or a `/credits` page.
- **HDRI:** any 2K from [Poly Haven overcast outdoor](https://polyhaven.com/hdris/outdoor/overcast).
- **Textures:** [Concrete Debris](https://polyhaven.com/a/concrete_debris), [Rebar Reinforced Concrete](https://polyhaven.com/a/rebar_reinforced_concrete), [Rust Coarse 01](https://polyhaven.com/a/rust_coarse_01) — all CC0.
- **Particles:** [Kenney Particle Pack](https://kenney.nl/assets/particle-pack) (CC0).

## Roadmap

See the full 6-week phased plan at `~/.claude/plans/smart-pivot-that-s-sharded-backus.md`. The current commit lands Week 1 + Week 2 in skeleton form (project scaffold + working drone-swarm interaction with placeholder geometry).
