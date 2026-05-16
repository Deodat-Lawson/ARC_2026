# A.R.C. — Autonomous Rescue Cluster

Post-disaster heterogeneous rescue fleet: **UGV + UAV + aerostat** coordinated by **Decision Hubs** (“octopus brain”) with **Gemma 4** reasoning — edge (**LiteRT**), local (**Ollama**), or cloud (**Google AI Studio**).

Built for **Gemma 4 Good Hackathon** (impact: disaster resilience; tech: LiteRT on-device).

The repository combines the **`Complete-Workflow-v1.0`** Python core (`arc_core`) with the **root Next.js 15 app** (marketing hero / Three.js, **`/lite`** 2D sim, and **`/demo-player`** MapLibre timeline playback), the **`ARC_2026-arc-lite-2d-demo`** subtree (scenario JSON, optional **`lite_sim`**, **`demo_player/`** static player copy, asset scripts), and a legacy **`demo_player/`** at repo root for static HTTP playback.

## Repository layout

| Path | Purpose |
|------|---------|
| `arc_core/` | Python package: agents, perception (Gemma), scheduler, communication, simulation pipelines, CLI runners, tests |
| `app/`, `components/` (root) | Next.js 15: marketing (R3F hero) + **`/lite`** (`lib/lite-sim/`) + **`/demo-player`** (`lib/demo-player/`, MapLibre + PMTiles) |
| `public/lite/` | **`scenario_canvas_lite.json`** for `/lite` |
| `public/demo-player/` | **`timeline.json`** for `/demo-player` |
| `arc_core/simulation/data/` | Canonical **`scenario_001.json`**, **`scenario_*.json`**, **`scenario_large.json`**, demo outputs (`earthquake_demo.json`, etc.) for Python / `timeline_generator` |
| `ARC_2026-arc-lite-2d-demo/` | **`lite_sim/`**, archived **`demo_player/`**, **`scripts/`**, optional **`public/`** staging |
| `demo_player/` (root) | Optional static playback: serve repo root over HTTP with `timeline.json` beside this folder |
| `requirements.txt` | Python dependencies |
| `pytest.ini` | Test discovery under `arc_core/tests` |

Runnable Python code lives under **`arc_core`**. Scenario and timeline defaults are defined in `arc_core/paths.py`.

## Requirements

- **Python** 3.10+ (3.13 tested)
- **Node.js** + **pnpm** (root Next.js app only)

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
# Precompute timeline for the Next.js demo player (recommended)
python -m arc_core.simulation.timeline_generator --steps 200 --output public/demo-player/timeline.json

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

With **`pnpm dev`** at repo root, open **http://localhost:3000/demo-player** (loads **`/demo-player/timeline.json`** from **`public/demo-player/`**). Map tiles are loaded via same-origin **`/api/pmtiles-proxy`**, which fixes PMTiles byte-range behavior against the public **`pmtiles.io`** CDN (it often returns **`200`** + full **`Content-Length`** for **`Range`** requests, which the PMTiles JS client rejects). The first open may pull the full archive (~6.6 MB) once into server memory per Node process.

**Static fallback:** generate `demo_player/timeline.json` and serve the repo root:

```bash
python -m http.server 8080
# http://localhost:8080/demo_player/
```

## Run — Frontend (root marketing site)

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 for the marketing site. **`/lite`** — 2D Lite sim (`public/lite/scenario_canvas_lite.json`). **`/demo-player`** — timeline playback (`public/demo-player/timeline.json`).

## Run — 2D Lite simulation (Next.js)

The interactive map + FPV view lives on **`/lite`** in the root app (same dev server as above).

The default scenario file is **`public/lite/scenario_canvas_lite.json`**. Larger **`scenario_001.json`** and friends for Python / timeline tooling live under **`arc_core/simulation/data/`** (and copies under **`public/simulation/`** for the Mission Command static page; select via `?scenario=…`).

Do not commit **`node_modules/`** or **`.next/`**.

### Mission Command + Gemma 4 on LiteRT (Google AI Edge / hackathon LiteRT track)

The static page **`/simulation`** calls **`/api/gemma-chat`**. For **real Gemma 4 E4B on-device inference** (LiteRT-LM, not LM Studio), run the OpenAI-compatible bridge and point Next.js at it:

1. Install Python deps: `pip install -r requirements.txt`
2. Ensure the **`.litertlm`** weights exist (see **Optional: Gemma on device (LiteRT)** above) or let **`GemmaPerceiver`** download **`litert-community/gemma-4-E4B-it-litert-lm`** on first init.
3. Start the bridge: **`pnpm litert:server`** or **`python scripts/litert_openai_server.py`** (default **http://127.0.0.1:8787**). Optional: set **`LITERT_VISION_BACKEND=gpu`** and **`LITERT_BACKEND=gpu`** for faster vision + LLM on discrete GPUs.
4. Copy **`.env.example` → `.env.local`** and set **`LITERT_OPENAI_BASE_URL=http://127.0.0.1:8787/v1`** (this takes priority over **`LMSTUDIO_BASE_URL`**).
5. Run **`pnpm dev`**, open **`/simulation`**. Health check: **GET `/api/gemma-chat`** (used by the UI badge).

The bridge passes browser FPV frames to LiteRT as **`{"type":"image","blob":"<base64>"}`** (see [LiteRT conversation schema](https://github.com/google-ai-edge/LiteRT-LM/blob/main/docs/api/cpp/conversation.md)). The same **`vision_backend`** wiring is enabled on **`GemmaPerceiver`**’s LiteRT engine for Python **`arc_core`** demos.

### Optional: road-aware timeline (`lite_sim`)

From repo root (needs both **`arc_core`** and **`lite_sim`** on `PYTHONPATH`):

```bash
PYTHONPATH=".:ARC_2026-arc-lite-2d-demo" python -m lite_sim.timeline_generator --steps 200 --output public/demo-player/timeline.json
```

Or from inside **`ARC_2026-arc-lite-2d-demo`**:

```bash
cd ARC_2026-arc-lite-2d-demo
PYTHONPATH=".:.." python -m lite_sim.timeline_generator --steps 200 --output ../public/demo-player/timeline.json
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
