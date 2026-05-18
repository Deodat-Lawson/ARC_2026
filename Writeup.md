# A.R.C. — Autonomous Rescue Cluster

**Gemma 4 Good Hackathon · Global Resilience + LiteRT**

## Problem & user

After a major urban earthquake, professional rescuers face a **72-hour survival window**, fragmented communications, and heterogeneous assets (UAV scouts, UGV extractors, aerostat relays). A fire-command officer at **T+2h** must prioritize victims, allocate limited battery, and keep mesh links alive—often **without reliable cloud connectivity**.

**A.R.C.** is an edge-first mission command stack that turns multimodal field data into **explainable, tool-grounded rescue decisions** using **Gemma 4 on LiteRT (E4B)**.

## Solution overview

| Layer | Role |
|-------|------|
| **Mission Command** (`/simulation`) | Browser UI: tactical map, FPV, Decision Hub CoT, fleet dialogue, commander brief |
| **Next.js API** (`/api/gemma-chat`) | LiteRT-only proxy with latency/token metadata for judges |
| **LiteRT bridge** (`scripts/litert_openai_server.py`) | OpenAI-compatible server; multimodal FPV → Gemma 4 E4B |
| **arc_core** | `DecisionHub`, `GemmaPerceiver`, function-calling tools, timeline precompute |

## Architecture

```text
                    ┌── Mission Command (browser) ──────────────────┐
                    │  /simulation  ──►  /api/gemma-chat            │
                    └────────────┬──────────────────────────────────┘
                                 │
  FPV frames ────────────────────┘
       │
       ▼
┌── Edge device ─────────────────────────────────────────────────────┐
│  Gemma 4 E4B (LiteRT)  ──►  function-calling tools (FC)          │
└──────────────────────────────▲─────────────────────────────────────┘
                               │
┌── arc_core (Python) ─────────┴───────────────────────────────────┐
│  timeline_generator ──► GemmaPerceiver ◄── DecisionHub            │
│                              ▲                                      │
│                              └── (optional) ◄── /simulation       │
└────────────────────────────────────────────────────────────────────┘
```

**Data flow (live demo):**

1. Operator enables **GEMMA4** and starts **RUN**.
2. Simulation builds grid context; agents call `/api/gemma-chat` (Drone_Alpha → Track_Beta → Relay_Gamma → Orchestrator).
3. FPV JPEG is sent as base64; LiteRT-LM runs vision + language on-device.
4. Header **metrics panel** shows MODE · LITERT, latency ms, backend, round count (screenshot-friendly).

**Offline timeline path:** `python -m arc_core.simulation.timeline_generator` uses the same `GemmaPerceiver` when `LITERT_MODEL_PATH` or `GEMMA_API_KEY` is set; output feeds `/demo-player`.

## Why Gemma 4

- **Edge E4B** fits disconnected disaster sites (LiteRT-LM, ~4GB weights).
- **Multimodal** FPV supports rubble/obstacle assessment without uploading video to cloud.
- **Function calling** (`calculate_survival_score`, `dispatch_rescue_task`) grounds CoT in structured actions.
- **Optional cloud** `gemma-4-26b-a4b-it` for hub-level planning via `GEMMA_API_MODEL`.

## LiteRT deployment

```bash
pip install -r requirements.txt
# models/gemma-4-E4B-it.litertlm from HuggingFace litert-community/gemma-4-E4B-it-litert-lm
python scripts/litert_openai_server.py   # http://127.0.0.1:8787
# .env.local: LITERT_OPENAI_BASE_URL=http://127.0.0.1:8787/v1
pnpm dev   # http://localhost:3000/simulation?ai=gemma
```

Optional: `LITERT_BACKEND=gpu`, `LITERT_VISION_BACKEND=gpu` for faster inference.

## Technical highlights

### GemmaPerceiver (`arc_core/perception/gemma_perceiver.py`)

- Backends: **LiteRT → API → Mock** (Ollama dev-only; no Gemma 3 in submission path).
- Per-agent instances (LLM2Swarm / octopus-brain pattern).
- Tools auto-schema’d for LiteRT-LM `create_conversation(..., tools=ARC_TOOLS)`.

### Mission Command UI

- **MOCK vs GEMMA4** toggle with honest labeling (`SIMULATION · RULE-BASED` vs `CLOSED LOOP · GEMMA-4 (LiteRT)`).
- **AI metrics panel**: MODE, BACKEND, LATENCY, TOKENS, AGENT, ROUND.
- Footer uplink/plan derived from measured latency (not hard-coded).

### Compliance

- All production inference paths reference **Gemma 4** model IDs.
- `LITERT_OPENAI_BASE_URL` required; no LM Studio fallback in `/api/gemma-chat`.

## Impact

- Targets **Global Resilience**: blind search, heterogeneous fleet, comms-degraded environments.
- **LiteRT track**: on-device Gemma 4 with measurable latency for judges.
- **Safety**: system is **decision support**; it does not replace certified rescue teams or incident command authority.

## Limitations

- Live demo needs local LiteRT weights + GPU/CPU time per agent round.
- Full `arc_core` step API (`/api/arc-hub`) is optional future work; browser sim uses rules + Gemma dialogue.
- Token counts on edge may show `n/a (edge)` when the runtime does not expose usage.

## Reproduce (judges)

See **README.md → Judge Quick Start**. Confirm `GET /api/gemma-chat` returns `ok: true`, header shows **● LIVE Gemma 4**, metrics update after RUN.

## Repository map

| Path | Notes |
|------|--------|
| `public/simulation/` | Mission Command |
| `app/api/gemma-chat/route.ts` | LiteRT proxy + meta |
| `scripts/litert_openai_server.py` | E4B bridge |
| `arc_core/agents/decision_hub.py` | Hub + Gemma reasoning |
| `arc_core/simulation/timeline_generator.py` | Precomputed playback |
| `Writeup.md` | This document |

## Team & acknowledgements

Built on **LiteRT-LM** ([google-ai-edge/LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM)), **Gemma 4**, and open multi-agent rescue research. See `whitepaper.md` for extended system design.
