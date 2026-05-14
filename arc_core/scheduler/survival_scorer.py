"""
SurvivalScorer — Survivor Priority Ranking Engine

Implements the four-dimensional scoring model from arc_core/config.py:
  S = w_env * F_env + w_phys * F_phys + w_time * F_time + w_social * F_social

Algorithm reference: disaster_uav_ugv_rescue_planner/survivor_prioritization
(Cherry0302/disaster_uav_ugv_rescue_planner — adapted from GA fitness
function to a deterministic weighted scorer for real-time use).

Can be overridden by GemmaPerceiver.score_survivor() for LLM-based scoring.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from arc_core.config import DEFAULT_CONFIG, SurvivalWeights
from arc_core.agents.agent_types import Survivor, EnvironmentReading, Coordinate3D


# ============================================================================
# Input Context
# ============================================================================

@dataclass
class SurvivorContext:
    """
    All inputs needed to score one survivor.
    Populated by DecisionHub.allocate_tasks() from live sensor data.
    """
    survivor: Survivor

    # Environmental (from nearest UAV/sensor)
    temperature_celsius: float = 22.0
    humidity_percent: float = 50.0
    air_quality_aqi: float = 50.0
    space_confinement: float = 0.5      # 0=open, 1=fully confined

    # Time
    disaster_elapsed_hours: float = 0.0

    # Rescue feasibility
    distance_to_nearest_ugv_m: float = 100.0
    available_uav_battery: float = 1.0   # 0~1, best available UAV

    # Social
    group_size: int = 1


# ============================================================================
# Scorer
# ============================================================================

class SurvivalScorer:
    """
    Deterministic survival probability scorer.

    Weights from config.py SurvivalWeights; caller may pass custom weights
    per disaster type (e.g. flood weights differ from earthquake weights).

    Scoring sub-functions mirrored from
    disaster_uav_ugv_rescue_planner/experiment_task_assignment_comparison.py
    — their fitness() penalised total path length; here we convert that
    intuition to a survivor urgency score.
    """

    def __init__(self, weights: Optional[SurvivalWeights] = None):
        self.weights = weights or DEFAULT_CONFIG.survival_weights

    # -- Main entry -----------------------------------------------------------

    def score(self, ctx: SurvivorContext) -> float:
        """
        Return [0, 1] survival score.  Higher = more urgent to rescue NOW.
        Designed so that a score > 0.7 triggers immediate UAV dispatch.
        """
        f_env    = self._env_factor(ctx)
        f_phys   = self._phys_factor(ctx.survivor)
        f_time   = self._time_factor(ctx)
        f_social = self._social_factor(ctx)

        w = self.weights
        score = (
            w.w_env    * f_env
            + w.w_phys * f_phys
            + w.w_time * f_time
            + w.w_social * f_social
        )
        return round(min(1.0, max(0.0, score)), 4)

    def rank(self, contexts: List[SurvivorContext]) -> List[Tuple[float, SurvivorContext]]:
        """
        Score and rank all survivors in descending urgency order.
        Returns list of (score, context) tuples.
        """
        scored = [(self.score(ctx), ctx) for ctx in contexts]
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored

    # -- Sub-factors ----------------------------------------------------------

    def _env_factor(self, ctx: SurvivorContext) -> float:
        """
        Environmental survivability.
        Extremes of temperature/humidity reduce the score.
        Confinement also reduces score (harder to rescue AND poorer air).
        """
        # Optimal temperature 20-25°C; penalise deviation
        temp_deviation = abs(ctx.temperature_celsius - 22.5)
        temp_score = max(0.0, 1.0 - temp_deviation / 40.0)

        # High humidity (>80%) or very low (<20%) reduces score
        if ctx.humidity_percent > 80:
            hum_score = max(0.0, 1.0 - (ctx.humidity_percent - 80) / 20.0)
        elif ctx.humidity_percent < 20:
            hum_score = ctx.humidity_percent / 20.0
        else:
            hum_score = 1.0

        # AQI penalty (>150 = unhealthy)
        aqi_score = max(0.0, 1.0 - max(0.0, ctx.air_quality_aqi - 50) / 200.0)

        # Confinement: fully confined = harder to breathe but also signals
        # faster air quality degradation
        confinement_penalty = ctx.space_confinement * 0.3

        env = (temp_score * 0.4 + hum_score * 0.3 + aqi_score * 0.3) - confinement_penalty
        return max(0.0, env)

    def _phys_factor(self, survivor: Survivor) -> float:
        """
        Physiological urgency.
        High injury severity → high urgency (must rescue first).
        Vital signs present → higher confidence.
        """
        # injury_severity: 0=none, 1=critical — invert for "needs help NOW"
        severity_urgency = survivor.injury_severity

        # Vital signals: presence of confirmed heartbeat/movement boosts confidence
        vital_confidence = 0.5   # default (unknown)
        if survivor.vital_signs:
            positive = sum(1 for v in survivor.vital_signs.values() if v)
            vital_confidence = positive / max(1, len(survivor.vital_signs))

        # Age risk factor (young children and elderly at higher risk)
        age_risk = 0.5
        if survivor.estimated_age is not None:
            if survivor.estimated_age < 10 or survivor.estimated_age > 65:
                age_risk = 0.8
            elif survivor.estimated_age < 18 or survivor.estimated_age > 55:
                age_risk = 0.65

        return (severity_urgency * 0.5 + vital_confidence * 0.3 + age_risk * 0.2)

    def _time_factor(self, ctx: SurvivorContext) -> float:
        """
        Time-critical urgency.
        72-hour golden window: linear decay from 1.0 → 0.0 over 72h.
        Accelerated decay for high-confinement or extreme temperatures.
        """
        golden_hours = 72.0
        base_decay = max(0.0, 1.0 - ctx.disaster_elapsed_hours / golden_hours)

        # Confinement accelerates air depletion → tighten window
        confinement_factor = 1.0 + ctx.space_confinement * 0.5
        effective_elapsed = ctx.disaster_elapsed_hours * confinement_factor

        # Extreme temperature shortens survival window
        temp_multiplier = 1.0
        if ctx.temperature_celsius > 35 or ctx.temperature_celsius < 5:
            temp_multiplier = 1.3

        adjusted_elapsed = effective_elapsed * temp_multiplier
        return max(0.0, 1.0 - adjusted_elapsed / golden_hours)

    def _social_factor(self, ctx: SurvivorContext) -> float:
        """
        Social/group factors.
        Larger groups at one location have higher combined value.
        Multiple trapped people with one rescue → efficiency bonus.
        """
        # Diminishing returns: rescuing 3 > rescuing 1, but not 3× as urgent
        group_value = math.log1p(ctx.group_size) / math.log1p(10)
        return min(1.0, group_value)
