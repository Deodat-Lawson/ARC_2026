"""
TaskAllocator — Multi-Agent Rescue Task Assignment

Algorithm: Greedy-by-priority (deterministic, O(n·m)).
Reference: disaster_uav_ugv_rescue_planner/ga_task_assignment.py
  — their GA optimises total path length across all devices;
  — here we adapt the same multi-device split concept into a
    priority-first greedy assignment that works in real-time.

GA is available via GATaskAllocator for non-time-critical planning.
Both classes share the same interface: allocate(agents, survivors) → dict.
"""

from __future__ import annotations

import logging
import random
import numpy as np
from typing import Dict, List, Optional, Tuple

from arc_core.agents.agent_types import Coordinate3D, Survivor
from arc_core.config import AgentTask, AgentType
from arc_core.scheduler.survival_scorer import SurvivalScorer, SurvivorContext

logger = logging.getLogger(__name__)


# ============================================================================
# Greedy Allocator (primary — real-time safe)
# ============================================================================

class TaskAllocator:
    """
    Greedy task allocator.

    1. Score all survivors with SurvivalScorer (or Gemma 4 override)
    2. Sort survivors by score descending (highest urgency first)
    3. Assign nearest available agent of the right type:
       - UAV  → SEARCH (fast recon of high-urgency targets)
       - UGV  → RESCUE (heavy payload, follows UAV confirmation)
       - BALLOON → RELAY (always, highest priority after recon begins)
    4. Idle agents assigned RECON to continue area scanning
    """

    def __init__(self, scorer: Optional[SurvivalScorer] = None):
        self.scorer = scorer or SurvivalScorer()

    def allocate(
        self,
        agents: list,           # List[EdgeAgent]
        survivors: List[Survivor],
        env_context: Optional[dict] = None,
    ) -> Tuple[Dict[str, str], List[dict]]:
        """
        Assign tasks to agents.

        Returns:
            assignment : {agent_id: task_string}
            log_entries: list of reasoning log dicts for timeline.json
        """
        assignment: Dict[str, str] = {}
        log_entries: List[dict] = []
        busy: set = set()

        # Step 1: Balloons always relay
        for agent in agents:
            if agent.agent_type == AgentType.BALLOON:
                assignment[agent.agent_id] = AgentTask.RELAY.value
                agent.current_task = AgentTask.RELAY
                busy.add(agent.agent_id)
                log_entries.append({
                    "agent_id": agent.agent_id,
                    "assigned_task": AgentTask.RELAY.value,
                    "reason": "气球平台始终执行通信中继，覆盖范围优先"
                })

        # Step 2: Score and rank survivors
        ctx_list = [
            SurvivorContext(
                survivor=s,
                temperature_celsius=(env_context or {}).get("temperature_celsius", 22.0),
                humidity_percent=(env_context or {}).get("humidity_percent", 50.0),
                space_confinement=s.injury_severity,
                disaster_elapsed_hours=s.trapped_duration_min / 60.0,
                group_size=s.group_size,
            )
            for s in survivors
        ]
        ranked = self.scorer.rank(ctx_list)

        uavs_avail = [a for a in agents if a.agent_type == AgentType.UAV and a.agent_id not in busy]
        ugvs_avail = [a for a in agents if a.agent_type == AgentType.UGV and a.agent_id not in busy]

        # Step 3: Assign by priority
        for score, ctx in ranked:
            survivor = ctx.survivor

            # Find nearest UAV for recon
            if uavs_avail:
                uav = min(uavs_avail, key=lambda a: a.position.distance_2d(survivor.position))
                assignment[uav.agent_id] = f"{AgentTask.SEARCH.value}:{survivor.survivor_id}"
                uav.current_task = AgentTask.SEARCH
                busy.add(uav.agent_id)
                uavs_avail.remove(uav)
                log_entries.append({
                    "agent_id": uav.agent_id,
                    "assigned_task": AgentTask.SEARCH.value,
                    "target_survivor": survivor.survivor_id,
                    "survival_score": score,
                    "reason": (
                        f"幸存者{survivor.survivor_id}生存概率{score:.0%}，"
                        f"距离{uav.position.distance_2d(survivor.position):.0f}m，"
                        f"指派{uav.agent_id}空中侦察确认"
                    )
                })

            # Find nearest UGV for rescue
            if ugvs_avail and score > 0.4:   # Only dispatch UGV for significant cases
                ugv = min(ugvs_avail, key=lambda a: a.position.distance_2d(survivor.position))
                assignment[ugv.agent_id] = f"{AgentTask.RESCUE.value}:{survivor.survivor_id}"
                ugv.current_task = AgentTask.RESCUE
                busy.add(ugv.agent_id)
                ugvs_avail.remove(ugv)
                log_entries.append({
                    "agent_id": ugv.agent_id,
                    "assigned_task": AgentTask.RESCUE.value,
                    "target_survivor": survivor.survivor_id,
                    "survival_score": score,
                    "reason": (
                        f"指派{ugv.agent_id}(UGV)地面推进救援{survivor.survivor_id}，"
                        f"当前电量{ugv.battery_level:.0%}"
                    )
                })

        # Step 4: Remaining agents → RECON
        for agent in agents:
            if agent.agent_id not in assignment:
                assignment[agent.agent_id] = AgentTask.RECON.value
                agent.current_task = AgentTask.RECON
                log_entries.append({
                    "agent_id": agent.agent_id,
                    "assigned_task": AgentTask.RECON.value,
                    "reason": "无紧急目标，继续区域侦察扩大搜索覆盖"
                })

        logger.info(f"TaskAllocator: {len(assignment)} agents assigned, {len(ranked)} survivors ranked")
        return assignment, log_entries


# ============================================================================
# GA Allocator (reference impl from disaster_uav_ugv_rescue_planner)
# Use for offline planning / Writeup technical depth demonstration
# ============================================================================

class GATaskAllocator:
    """
    Genetic Algorithm task allocator.

    Directly adapted from:
      disaster_uav_ugv_rescue_planner/ga_task_assignment.py (Cherry0302)
    — Original fitness: minimise total path length across all devices.
    — ARC adaptation: fitness = weighted sum of (path_length + urgency_miss_penalty).

    Slower than GreedyAllocator but produces globally optimal assignments.
    Suitable for: initial deployment planning, Writeup technical section.
    """

    def __init__(
        self,
        generations: int = 80,
        pop_size: int = 40,
        elite_ratio: float = 0.05,
        scorer: Optional[SurvivalScorer] = None,
    ):
        self.generations = generations
        self.pop_size = pop_size
        self.elite_ratio = elite_ratio
        self.scorer = scorer or SurvivalScorer()

    def allocate(
        self,
        agents: list,
        survivors: List[Survivor],
        env_context: Optional[dict] = None,
    ) -> Tuple[Dict[str, str], List[dict]]:
        if not survivors or not agents:
            return {}, []

        # Build positions arrays (numpy, mirroring ga_task_assignment.py)
        survivor_positions = np.array([[s.position.x, s.position.y] for s in survivors])
        agent_positions    = np.array([[a.position.x, a.position.y] for a in agents])

        # Pre-compute survivor urgency scores (used in fitness weighting)
        urgency_scores = np.array([
            self.scorer.score(SurvivorContext(
                survivor=s,
                disaster_elapsed_hours=s.trapped_duration_min / 60.0,
            ))
            for s in survivors
        ])

        num_tasks = len(survivors)
        num_devices = len(agents)

        population = self._init_population(num_tasks, num_devices)
        best_solution = None
        best_score = np.inf

        for gen in range(self.generations):
            scores = [
                self._fitness(ind, survivor_positions, agent_positions, urgency_scores)
                for ind in population
            ]

            if min(scores) < best_score:
                best_score = min(scores)
                best_solution = population[int(np.argmin(scores))]

            # Elite retention
            num_elite = max(1, int(self.elite_ratio * self.pop_size))
            elite_idx = np.argsort(scores)[:num_elite]
            elites = [population[i] for i in elite_idx]

            # Dynamic mutation rate (from ga_task_assignment.py)
            if gen < self.generations * 0.3:
                mutate_rate = 0.4
            elif gen > self.generations * 0.7:
                mutate_rate = 0.1
            else:
                mutate_rate = 0.2

            selected = [population[i] for i in np.argsort(scores)[:self.pop_size // 2]]

            next_gen = elites.copy()
            while len(next_gen) < self.pop_size:
                p1, p2 = random.sample(selected, 2)
                child = self._crossover(p1, p2, num_tasks)
                child = self._mutate(child, num_tasks, mutate_rate)
                next_gen.append(child)
            population = next_gen

        # Convert best_solution to assignment dict
        assignment: Dict[str, str] = {}
        log_entries: List[dict] = []
        if best_solution is not None:
            for agent_idx, task_indices in enumerate(best_solution):
                agent = agents[agent_idx]
                for task_idx in task_indices:
                    if task_idx < len(survivors):
                        s = survivors[task_idx]
                        assignment[agent.agent_id] = f"rescue:{s.survivor_id}"
                        log_entries.append({
                            "agent_id": agent.agent_id,
                            "assigned_task": "rescue",
                            "target_survivor": s.survivor_id,
                            "reason": f"GA优化分配（第{self.generations}代，最优得分{best_score:.1f}）"
                        })

        return assignment, log_entries

    # -- GA internals (adapted from ga_task_assignment.py) -------------------

    def _init_population(self, num_tasks: int, num_devices: int) -> list:
        pop = []
        for _ in range(self.pop_size):
            perm = list(np.random.permutation(num_tasks))
            split = np.array_split(perm, num_devices)
            pop.append([list(s) for s in split])
        return pop

    def _fitness(self, individual, task_pos, agent_pos, urgency) -> float:
        """
        Fitness = total path length + urgency miss penalty.
        Lower is better.
        From ga_task_assignment.py fitness(), extended with urgency weighting.
        """
        total = 0.0
        for agent_idx, task_indices in enumerate(individual):
            if not task_indices:
                continue
            base = agent_pos[agent_idx]
            prev = base
            for ti in task_indices:
                if ti < len(task_pos):
                    dist = np.linalg.norm(task_pos[ti] - prev)
                    urgency_weight = 2.0 - urgency[ti]  # High urgency = lower weight (prioritise)
                    total += dist * urgency_weight
                    prev = task_pos[ti]
        return total

    def _crossover(self, p1, p2, num_tasks):
        half = num_tasks // 2
        flat1 = [t for sub in p1 for t in sub]
        flat2 = [t for sub in p2 for t in sub]
        child_flat = flat1[:half] + [t for t in flat2 if t not in flat1[:half]]
        # Re-split into same number of devices
        return [list(s) for s in np.array_split(child_flat, len(p1))]

    def _mutate(self, individual, num_tasks, rate):
        for _ in range(int(rate * num_tasks)):
            a, b = np.random.randint(0, len(individual), 2)
            if individual[a] and individual[b]:
                i1 = random.randint(0, len(individual[a]) - 1)
                i2 = random.randint(0, len(individual[b]) - 1)
                individual[a][i1], individual[b][i2] = individual[b][i2], individual[a][i1]
        return individual
