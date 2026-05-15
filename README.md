# A.R.C. — Autonomous Rescue Cluster

Post-disaster heterogeneous rescue fleet: **UGV + UAV + aerostat** coordinated by **Decision Hubs** (“octopus brain”) with **Gemma 4** reasoning — edge (**LiteRT**), local (**Ollama**), or cloud (**Google AI Studio**).

Built for **Gemma 4 Good Hackathon** (impact: disaster resilience; tech: LiteRT on-device).

The repository combines the **`Complete-Workflow-v1.0`** Python core (`arc_core`) with the **root marketing site** (Next.js 15 hero / Three.js), the **`ARC_2026-arc-lite-2d-demo`** subtree (Next.js + **canvas 2D Lite sim** + scenario JSON + optional **`lite_sim`** road-aware timeline generator), and the tactical **`demo_player`** (MapLibre basemap + canvas overlay).

## Repository layout

| Path | Purpose |
|------|---------|
| `arc_core/` | Python package: agents, perception (Gemma), scheduler, communication, simulation pipelines, CLI runners, tests |
| `app/`, `components/` (root) | Main marketing landing: Next.js 15 App Router + React Three Fiber hero |
| `ARC_2026-arc-lite-2d-demo/` | Next.js subtree + **`index.html` / `app.js` / `styles.css`** (browser canvas 2D sim), **`scenario_canvas_lite.json`** (small demo map), **`scenario_*.json`** for tooling, **`lite_sim/`** (road-graph timeline generator; optional vs `arc_core`) |
| `demo_player/` | Static playback UI for `timeline.json` |
| `requirements.txt` | Python dependencies |
| `pytest.ini` | Test discovery under `arc_core/tests` |

Runnable Python code lives under **`arc_core`**. Scenario and timeline defaults are defined in `arc_core/paths.py`.

## Requirements

- **Python** 3.10+ (3.13 tested)
- **Node.js** + **pnpm** (for the root marketing app and optionally `ARC_2026-arc-lite-2d-demo`)

### Optional: Gemma on device (LiteRT)

- Install `litert-lm` (see `requirements.txt`).
- Download **`gemma-4-E4B-it.litertlm`** from Hugging Face: [`litert-community/gemma-4-E4B-it-litert-lm`](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm)
- Set environment variable `LITERT_MODEL_PATH` to the `.litertlm` file path, or place it at **`models/gemma-4-E4B-it.litertlm`** under the repository root (default if the env var is unset).

### Optional: faster cloud inference

- Set `GEMMA_API_KEY` or `GOOGLE_API_KEY` (Google AI Studio) for API mode.

### Optional: Ollama (local, no key)

- Run `ollama pull gemma3:4b` and keep the Ollama daemon running; `GemmaPerceiver` can fall back to it when LiteRT/API are unavailable.

## Install (Python)

```bash
cd /path/to/ARC_2026
pip install -r requirements.txt
```

## Run — Python demos

From the **repository root** (`ARC_2026/`):

```bash
# End-to-end skeleton demo (mock scenario → hubs → tasks → snapshot JSON)
python -m arc_core.runners
```

Outputs are written under `arc_core/simulation/data/` (e.g. `earthquake_demo.json`, `arc_output_snapshot.json`).

```bash
# Precompute timeline for the demo player
python -m arc_core.simulation.timeline_generator --steps 200 --output demo_player/timeline.json

# Interactive or preset scenario JSON
python -m arc_core.simulation.scenario_builder --preset earthquake

# Large multi-depot scenario
python -m arc_core.simulation.build_large_scenario --seed 2026
```

```bash
# Tests
pytest
```

### Demo player (MapLibre + tactical canvas)

After generating `demo_player/timeline.json`, serve the folder over HTTP:

```bash
python -m http.server 8080
# Open http://localhost:8080/demo_player/
```

## Run — Frontend (root marketing site)

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 .

## Run — `ARC_2026-arc-lite-2d-demo` (Next.js + static canvas)

### Next.js dev server

```bash
cd ARC_2026-arc-lite-2d-demo
pnpm install
pnpm dev
```

Open http://localhost:3000 (or the port Next prints).

Do not commit **`node_modules/`** or **`.next/`**.

### Canvas 2D Lite simulation (static HTML)

From **`ARC_2026-arc-lite-2d-demo/`** (serve this folder over HTTP so ES modules / fetch work):

```bash
cd ARC_2026-arc-lite-2d-demo
python -m http.server 8080
# Open http://localhost:8080/index.html
```

The canvas loads **`scenario_canvas_lite.json`** (5-victim / 4-agent demo). **`scenario_001.json`** in the same folder is the larger JSON used by Python / timeline tooling.

### Optional: road-aware timeline (`lite_sim`)

From repo root (needs both **`arc_core`** and **`lite_sim`** on `PYTHONPATH`):

```bash
PYTHONPATH=".:ARC_2026-arc-lite-2d-demo" python -m lite_sim.timeline_generator --steps 200 --output demo_player/timeline.json
```

Or from inside **`ARC_2026-arc-lite-2d-demo`**:

```bash
cd ARC_2026-arc-lite-2d-demo
PYTHONPATH=".:.." python -m lite_sim.timeline_generator --steps 200 --output ../demo_player/timeline.json
```

## Frontend stack (from arc-lite)

- Next.js 15 (App Router) + React 19 + TypeScript  
- Tailwind CSS v4 (CSS-first config where used)  
- React Three Fiber + Drei + postprocessing  
- Theatre.js available for cinematic camera work in hero components  

Compressed GLB/Text assets live under `public/`; see `scripts/convert-assets.mjs` for the geometry pipeline.

## Acknowledgements

Architecture and tooling draw on open components including **LiteRT-LM** ([`google-ai-edge/LiteRT-LM`](https://github.com/google-ai-edge/LiteRT-LM)), **google-deepmind/gemma**, and multi-agent UAV–UGV planning literature cited in team materials.

## License

See repository `LICENSE` if present; otherwise follow team / hackathon submission terms.
