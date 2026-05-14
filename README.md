# A.R.C. — Autonomous Rescue Cluster

Post-disaster heterogeneous rescue fleet: **UGV + UAV + aerostat** coordinated by **Decision Hubs** (“octopus brain”) with **Gemma 4** reasoning — edge (**LiteRT**), local (**Ollama**), or cloud (**Google AI Studio**).

Built for **Gemma 4 Good Hackathon** (impact: disaster resilience; tech: LiteRT on-device).

## Repository layout

| Path | Purpose |
|------|---------|
| `arc_core/` | Python package: agents, perception (Gemma), scheduler, communication, simulation pipelines, CLI runners, tests |
| `ARC_2026-arc-lite-2d-demo/` | Next.js + Three.js landing / 2D-lite scenario UI (install deps locally; do not commit `node_modules` or `.next`) |
| `requirements.txt` | Python dependencies |
| `pytest.ini` | Test discovery under `arc_core/tests` |

Runnable Python code lives under **`arc_core`**. Default repo paths for scenarios and timeline output are defined in `arc_core/paths.py`.

## Requirements

- **Python** 3.10+ (3.13 tested)
- **Node.js** + **pnpm** (only for `ARC_2026-arc-lite-2d-demo`)

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

## Run

From the **repository root** (`ARC_2026/`):

```bash
# End-to-end skeleton demo (mock scenario → hubs → tasks → snapshot JSON)
python -m arc_core.runners
```

Outputs are written under `arc_core/simulation/data/` (e.g. `earthquake_demo.json`, `arc_output_snapshot.json`).

```bash
# Precompute timeline for the demo player (default scenario path in arc_core.paths)
python -m arc_core.simulation.timeline_generator --steps 200

# Interactive or preset scenario JSON
python -m arc_core.simulation.scenario_builder --preset earthquake

# Large multi-depot scenario
python -m arc_core.simulation.build_large_scenario --seed 2026
```

```bash
# Tests
pytest
```

### Frontend (`ARC_2026-arc-lite-2d-demo`)

```bash
cd ARC_2026-arc-lite-2d-demo
pnpm install
pnpm dev
```

Do not commit **`node_modules/`** or **`.next/`**; they are listed in that package’s `.gitignore`.

## Acknowledgements

Architecture and tooling draw on open components documented in the team’s internal notes; public references include **LiteRT-LM** ([`google-ai-edge/LiteRT-LM`](https://github.com/google-ai-edge/LiteRT-LM)), **google-deepmind/gemma**, and multi-agent / UAV–UGV planning literature cited in project materials.

## License

See repository `LICENSE` if present; otherwise treat usage as team / hackathon submission terms.
