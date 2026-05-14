# A.R.C. — Autonomous Rescue Cluster

Post-disaster heterogeneous rescue fleet: **UGV + UAV + aerostat** coordinated by **Decision Hubs** (“octopus brain”) with **Gemma 4** reasoning — edge (**LiteRT**), local (**Ollama**), or cloud (**Google AI Studio**).

Built for **Gemma 4 Good Hackathon** (impact: disaster resilience; tech: LiteRT on-device).

The repository combines the **`Complete-Workflow-v1.0`** Python core with the **`arc-lite-2d-demo`** marketing site at the repo root (Next.js 15 hero / Three.js) and the tactical **`demo_player`** (MapLibre basemap + canvas overlay).

## Repository layout

| Path | Purpose |
|------|---------|
| `arc_core/` | Python package: agents, perception (Gemma), scheduler, communication, simulation pipelines, CLI runners, tests |
| `app/`, `components/` (root) | Main marketing landing: Next.js 15 App Router + React Three Fiber hero |
| `ARC_2026-arc-lite-2d-demo/` | Secondary Next.js subtree with scenario JSON variants (same stack; optional local install) |
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
- Set environment variable `LITERT_MODEL_PATH` to the `.litertlm` file path, or place it at the default path used in `arc_core/perception/gemma_perceiver.py`.

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

## Run — Frontend (`ARC_2026-arc-lite-2d-demo`)

```bash
cd ARC_2026-arc-lite-2d-demo
pnpm install
pnpm dev
```

Do not commit **`node_modules/`** or **`.next/`**.

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
