"""
GemmaPerceiver — Gemma 4 Multimodal Perception & Reasoning Engine

Supports inference backends (auto-selected in priority order):
  1. LiteRT  — google-ai-edge/LiteRT-LM v0.11.0, Gemma 4 on-device
               model: litert-community/gemma-4-E4B-it-litert-lm
  2. API     — Google AI Studio (Gemma 4 cloud, needs GEMMA_API_KEY)
  3. Mock    — deterministic fallback (dev / unit tests)

Ollama is dev-only; use mode="litert" for hackathon demos.

Function Calling (LiteRT + API):
  LiteRT-LM accepts plain Python functions as tools — annotated callables
  are auto-converted to OpenAPI JSON schema by the library.
  Reference: google-ai-edge/LiteRT-LM interfaces.Tool + AbstractConversation

LLM2Swarm Direct Integration pattern:
  Each DecisionHub holds its own GemmaPerceiver instance and calls
  reason() independently — no central broker, matching octopus-brain arch.

Installed packages:
  - litert-lm>=0.11.0        (google-ai-edge/LiteRT-LM)
  - gemma==4.0.0             (google-deepmind/gemma)
  - google-genai>=1.0.0      (Google AI Studio API)
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

logger = logging.getLogger(__name__)

# Default: repo_root/models/gemma-4-E4B-it.litertlm (override with LITERT_MODEL_PATH)
_DEFAULT_LITERT_UNDER_REPO = (
    Path(__file__).resolve().parent.parent.parent / "models" / "gemma-4-E4B-it.litertlm"
)
DEFAULT_LITERT_MODEL_PATH = os.environ.get(
    "LITERT_MODEL_PATH",
    str(_DEFAULT_LITERT_UNDER_REPO),
)

ARC_SYSTEM_PROMPT = (
    "You are the decision AI for A.R.C. (Autonomous Rescue Cluster), deployed on edge devices "
    "in disaster zones. You operate offline when required. Be concise and decisive; explain "
    "reasoning in English. Prioritize: survivor survival probability > fleet battery > "
    "communication relay > path efficiency."
)

DEFAULT_GEMMA_API_MODEL = os.environ.get("GEMMA_API_MODEL", "gemma-4-26b-a4b-it")


# ============================================================================
# LiteRT Function Calling Tools
# LiteRT-LM accepts plain Python callables — type hints become the schema
# Reference: litert_lm.interfaces.AbstractConversation tools parameter
# ============================================================================

def calculate_survival_score(
    trapped_hours: float,
    vital_signal_strength: float,
    space_confinement: str = "partial",
    temperature_celsius: float = 22.0,
    humidity_percent: float = 50.0,
    distance_to_ugv_m: float = 100.0,
) -> float:
    """
    Calculate survival probability (0.0-1.0) for a trapped survivor.
    Higher score means more urgent to rescue.

    Args:
        trapped_hours: Hours elapsed since disaster.
        vital_signal_strength: Life signal from sensors, 0.0 to 1.0.
        space_confinement: 'open', 'partial', or 'confined'.
        temperature_celsius: Ambient temperature at survivor location.
        humidity_percent: Relative humidity 0-100.
        distance_to_ugv_m: Distance from nearest rescue vehicle in meters.
    """
    time_score = max(0.0, 1.0 - trapped_hours / 72.0)
    temp_penalty = abs(temperature_celsius - 22.5) / 40.0
    hum_penalty = max(0.0, humidity_percent - 80.0) / 20.0
    env_score = max(0.0, 1.0 - temp_penalty - hum_penalty)
    confinement_map = {"open": 0.9, "partial": 0.6, "confined": 0.3}
    confinement = confinement_map.get(space_confinement, 0.6)
    rescue_score = max(0.0, 1.0 - distance_to_ugv_m / 500.0)

    raw = (
        0.35 * vital_signal_strength
        + 0.25 * time_score
        + 0.20 * env_score
        + 0.20 * rescue_score
    ) * confinement
    return round(min(1.0, max(0.0, raw)), 3)


def dispatch_rescue_task(
    agent_id: str,
    task: str,
    target_survivor_id: str = "",
    priority: int = 5,
    reasoning: str = "",
) -> dict:
    """
    Assign a rescue task to a specific agent in the fleet.

    Args:
        agent_id: ID of the agent (e.g. 'UAV-1', 'UGV-1', 'Balloon-1').
        task: One of: recon, search, rescue, relay, charge, deploy_balloon, idle.
        target_survivor_id: Survivor ID this task targets (if applicable).
        priority: Urgency 1-10, higher is more urgent.
        reasoning: Chinese explanation of why this task was assigned.
    """
    return {
        "agent_id": agent_id,
        "task": task,
        "target": target_survivor_id,
        "priority": priority,
        "reasoning": reasoning,
    }


ARC_TOOLS = [calculate_survival_score, dispatch_rescue_task]


# ============================================================================
# Result container
# ============================================================================

@dataclass
class PerceptionResult:
    """Structured output from a single Gemma 4 inference call."""
    raw_text: str = ""
    survival_score: Optional[float] = None
    task_dispatches: List[Dict[str, Any]] = field(default_factory=list)
    reasoning_chain: str = ""
    mode_used: str = "mock"
    latency_ms: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "raw_text": self.raw_text,
            "survival_score": self.survival_score,
            "task_dispatches": self.task_dispatches,
            "reasoning_chain": self.reasoning_chain,
            "mode_used": self.mode_used,
            "latency_ms": round(self.latency_ms, 1),
        }


# ============================================================================
# GemmaPerceiver
# ============================================================================

class GemmaPerceiver:
    """
    Per-agent Gemma 4 reasoning engine.

    Auto-selects backend: LiteRT → API → Mock.
    Override with mode= parameter (use mode="litert" for submission demos).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        mode: str = "auto",
        agent_id: str = "unknown",
        gemma_model: str = "E2B",
        ollama_model: str = "gemma4:4b",
        litert_model_path: str = DEFAULT_LITERT_MODEL_PATH,
    ):
        self.agent_id = agent_id
        self.gemma_model = gemma_model
        self._ollama_model = ollama_model
        self._litert_model_path = litert_model_path
        self._mode = mode
        self._litert_engine = None   # litert_lm.engine.Engine
        self._genai_model = None     # google.generativeai.GenerativeModel
        self._call_count = 0
        self._total_latency_ms = 0.0

        resolved_key = (
            api_key
            or os.environ.get("GEMMA_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
        )

        if mode == "mock":
            logger.info(f"[{agent_id}] GemmaPerceiver: MOCK mode")
            return

        if mode in ("auto", "litert"):
            if self._try_init_litert():
                return

        if mode == "ollama":
            if self._try_init_ollama(ollama_model):
                return

        if mode in ("auto", "api") and resolved_key:
            if self._try_init_api(resolved_key):
                return

        self._mode = "mock"
        logger.info(f"[{agent_id}] GemmaPerceiver: no backend available → MOCK")

    # ── Backend Init ─────────────────────────────────────────────────────────

    def _try_init_litert(self) -> bool:
        """
        Initialise LiteRT-LM Engine.
        API: litert_lm.engine.Engine(model_path, backend)
        Reference: google-ai-edge/LiteRT-LM v0.11.0
        """
        if not os.path.isfile(self._litert_model_path):
            logger.info(
                f"[{self.agent_id}] LiteRT model not found at {self._litert_model_path}. "
                f"Downloading… (or set LITERT_MODEL_PATH env var)"
            )
            downloaded = self._download_litert_model()
            if not downloaded:
                return False

        try:
            from litert_lm.engine import Engine
            from litert_lm.interfaces import Backend
            self._litert_engine = Engine(
                model_path=self._litert_model_path,
                backend=Backend.CPU,          # GPU: Backend.GPU
                vision_backend=Backend.CPU,  # Required for Gemma 4 E4B image understanding (FPV, etc.)
                max_num_tokens=2048,
            )
            self._mode = "litert"
            logger.info(
                f"[{self.agent_id}] GemmaPerceiver: LiteRT mode "
                f"(Gemma 4 E4B, {self._litert_model_path})"
            )
            return True
        except Exception as e:
            logger.warning(f"[{self.agent_id}] LiteRT init failed: {e}")
            return False

    def _download_litert_model(self) -> bool:
        """Download Gemma 4 E4B LiteRT model from HuggingFace Hub."""
        try:
            from huggingface_hub import hf_hub_download
            local_dir = os.path.dirname(self._litert_model_path)
            os.makedirs(local_dir, exist_ok=True)
            logger.info(
                f"[{self.agent_id}] Downloading litert-community/gemma-4-E4B-it-litert-lm "
                f"→ {local_dir} (~4GB, please wait…)"
            )
            hf_hub_download(
                repo_id="litert-community/gemma-4-E4B-it-litert-lm",
                filename="gemma-4-E4B-it.litertlm",
                local_dir=local_dir,
                local_dir_use_symlinks=False,
            )
            return os.path.isfile(self._litert_model_path)
        except Exception as e:
            logger.warning(f"[{self.agent_id}] Model download failed: {e}")
            return False

    def _try_init_ollama(self, model_name: str) -> bool:
        """Check Ollama server and model availability."""
        try:
            import urllib.request, json
            with urllib.request.urlopen(
                "http://localhost:11434/api/tags", timeout=2
            ) as resp:
                data = json.loads(resp.read())
                available = [m["name"] for m in data.get("models", [])]
                if not any(
                    m == model_name or m.startswith(model_name.split(":")[0])
                    for m in available
                ):
                    logger.info(
                        f"[{self.agent_id}] Ollama running but {model_name} not found "
                        f"(available: {available})"
                    )
                    return False
            self._mode = "ollama"
            logger.info(f"[{self.agent_id}] GemmaPerceiver: Ollama mode ({model_name})")
            return True
        except Exception as e:
            logger.debug(f"[{self.agent_id}] Ollama unavailable: {e}")
            return False

    def _try_init_api(self, api_key: str) -> bool:
        """Initialise Google AI Studio API client."""
        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            self._genai_model = genai.GenerativeModel(
                model_name=DEFAULT_GEMMA_API_MODEL,
                system_instruction=ARC_SYSTEM_PROMPT,
            )
            self._mode = "api"
            logger.info(f"[{self.agent_id}] GemmaPerceiver: API mode (Google AI Studio)")
            return True
        except Exception as e:
            logger.warning(f"[{self.agent_id}] API init failed: {e}")
            return False

    # ── Public API ────────────────────────────────────────────────────────────

    def reason(self, context: str, use_tools: bool = False) -> PerceptionResult:
        """
        General-purpose reasoning. Called by DecisionHub._gemma_reason().
        LLM2Swarm pattern: each agent calls independently.
        """
        t0 = time.time()
        tools = ARC_TOOLS if use_tools else []

        if self._mode == "litert":
            result = self._litert_call(context, tools)
        elif self._mode == "ollama":
            result = self._ollama_call(context)
        elif self._mode == "api" and self._genai_model:
            result = self._api_call(context)
        else:
            result = self._mock_reason(context)

        result.latency_ms = (time.time() - t0) * 1000
        self._call_count += 1
        self._total_latency_ms += result.latency_ms
        return result

    def analyze_scene(self, sensor_data_dict: dict) -> PerceptionResult:
        """Multimodal scene analysis from SensorData.to_dict() output."""
        env = sensor_data_dict.get("environment") or {}
        vitals = sensor_data_dict.get("vital_signals", [])
        prompt = (
            f"Agent {sensor_data_dict.get('agent_id', '?')} sensor data:\n"
            f"Position: {sensor_data_dict.get('position', {})}\n"
            f"Environment: temp {env.get('temperature_c', '?')}°C, "
            f"humidity {env.get('humidity_pct', '?')}%\n"
            f"Vital signals: {len(vitals)}\n"
            f"Assess hazard level and recommend next action."
        )
        return self.reason(prompt)

    def score_survivor(self, ctx: dict) -> PerceptionResult:
        """Function Calling: score a single survivor."""
        prompt = (
            f"Use calculate_survival_score for this survivor:\n"
            f"Trapped {ctx.get('trapped_hours', 0)} hours, "
            f"vital signal {ctx.get('vital_signal_strength', 0.5)}, "
            f"temperature {ctx.get('temperature_celsius', 22)}°C, "
            f"confinement: {ctx.get('space_confinement', 'partial')}."
        )
        result = self.reason(prompt, use_tools=True)
        if result.survival_score is None:
            result.survival_score = calculate_survival_score(**{
                k: v for k, v in ctx.items()
                if k in calculate_survival_score.__code__.co_varnames
            })
        return result

    def dispatch_tasks(self, hub_id: str, agents: list, survivors: list) -> PerceptionResult:
        """Function Calling: assign rescue tasks via Gemma 4."""
        agents_str = ", ".join(
            f"{a.get('id')}({a.get('type')},{int(a.get('battery',0)*100)}% batt)"
            for a in agents
        )
        survivors_str = ", ".join(
            f"{s.get('survivor_id')}(injury {int(s.get('injury_severity',0)*100)}%)"
            for s in survivors
        )
        prompt = (
            f"Decision hub {hub_id} task allocation:\n"
            f"Available agents: {agents_str}\n"
            f"Survivors: {survivors_str}\n"
            f"Use dispatch_rescue_task for each agent. Prioritize critical survivors; "
            f"keep communication relays online."
        )
        return self.reason(prompt, use_tools=True)

    # ── Backend Calls ─────────────────────────────────────────────────────────

    def _litert_call(self, prompt: str, tools: list) -> PerceptionResult:
        """
        LiteRT-LM inference via Engine + Conversation.
        API reference: google-ai-edge/LiteRT-LM v0.11.0
          engine.create_conversation(system_message, tools)
          conv.send_message(text) → {"role": "assistant", "content": [...]}
        """
        result = PerceptionResult(mode_used="litert")
        try:
            with self._litert_engine.create_conversation(
                system_message=ARC_SYSTEM_PROMPT,
                tools=tools if tools else None,
                automatic_tool_calling=True,
            ) as conv:
                response = conv.send_message(prompt)
                # response: {"role": "assistant", "content": [{"type":"text","text":"..."}]}
                content = response.get("content", [])
                if isinstance(content, list):
                    parts = []
                    for item in content:
                        if isinstance(item, dict):
                            if item.get("type") == "text":
                                parts.append(item.get("text", ""))
                            elif item.get("type") == "tool_result":
                                # Function was called and returned a result
                                tool_result = item.get("result")
                                if isinstance(tool_result, float):
                                    result.survival_score = tool_result
                                elif isinstance(tool_result, dict):
                                    result.task_dispatches.append(tool_result)
                    result.raw_text = "\n".join(parts)
                elif isinstance(content, str):
                    result.raw_text = content
                result.reasoning_chain = result.raw_text
        except Exception as e:
            result.error = str(e)
            logger.warning(f"[{self.agent_id}] LiteRT call failed: {e}")
            return self._mock_reason(prompt)
        return result

    def _ollama_call(self, prompt: str) -> PerceptionResult:
        """Ollama local inference (no internet, no API key)."""
        import urllib.request, json
        result = PerceptionResult(mode_used="ollama")
        try:
            body = json.dumps({
                "model": self._ollama_model,
                "prompt": prompt,
                "system": ARC_SYSTEM_PROMPT,
                "stream": False,
            }).encode()
            req = urllib.request.Request(
                "http://localhost:11434/api/generate",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read())
                result.raw_text = data.get("response", "")
                result.reasoning_chain = result.raw_text
        except Exception as e:
            result.error = str(e)
            logger.warning(f"[{self.agent_id}] Ollama call failed: {e}")
            return self._mock_reason(prompt)
        return result

    def _api_call(self, prompt: str) -> PerceptionResult:
        """Google AI Studio API call."""
        result = PerceptionResult(mode_used="api")
        try:
            response = self._genai_model.generate_content(prompt)
            result.raw_text = response.text or ""
            result.reasoning_chain = result.raw_text
            result.survival_score = self._parse_score(result.raw_text)
        except Exception as e:
            result.error = str(e)
            logger.warning(f"[{self.agent_id}] API call failed: {e}")
            return self._mock_reason(prompt)
        return result

    def _mock_reason(self, context: str) -> PerceptionResult:
        """Deterministic mock — dev / offline testing."""
        text = (
            f"[MOCK Gemma4/{self.gemma_model}] Analysis: {context[:60]}…\n"
            f"Recommend: UAV recon nearest signal, UGV on standby, balloons maintain relay. "
            f"Estimated survival window {max(1, 72 - self._call_count)} hours."
        )
        return PerceptionResult(
            raw_text=text,
            reasoning_chain=text,
            survival_score=round(0.60 + (self._call_count % 5) * 0.04, 2),
            mode_used="mock",
        )

    # ── Utilities ─────────────────────────────────────────────────────────────

    def _parse_score(self, text: str) -> Optional[float]:
        """Extract a numeric survival score from free-form LLM text."""
        matches = re.findall(
            r"(?:概率|score|分数|生存率)[：:\s]*([0-9.]+)", text, re.IGNORECASE
        )
        if matches:
            try:
                return min(1.0, max(0.0, float(matches[0])))
            except ValueError:
                pass
        return None

    def stats(self) -> dict:
        avg = self._total_latency_ms / max(1, self._call_count)
        return {
            "agent_id": self.agent_id,
            "mode": self._mode,
            "gemma_model": self.gemma_model,
            "calls": self._call_count,
            "avg_latency_ms": round(avg, 1),
        }
