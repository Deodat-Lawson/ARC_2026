"""
Scenario Adapter — Bidirectional format converter

Converts between scenario_001.json (grid JSON) format
and arc_core's internal data models.

Grid JSON format (input):
  - 30x30 grid map with cell_size_m
  - victims: {id, location:[x,y], hp, damage_per_step, buriedness, thermal_signal, ...}
  - agents: {id, type, role, location:[x,y], battery, speed, sensors, ...}
  - communication: {base_range, relay_range, ...}

arc_core format (internal):
  - DisasterScenario with Survivor objects
  - EdgeAgent with Coordinate3D positions
"""

from __future__ import annotations

import logging
from typing import Dict, List, Tuple

from arc_core.config import AgentType, AgentTask, DisasterType
from arc_core.agents.agent_types import Coordinate3D, Survivor, VitalSignal
from arc_core.agents.edge_agent import EdgeAgent
from arc_core.interfaces.scenario_reader import DisasterScenario, InfrastructureStatus

logger = logging.getLogger(__name__)


class ScenarioAdapter:
    """Bidirectional converter between grid scenario JSON and arc_core models."""

    def __init__(self, cell_size_m: float = 10.0):
        self.cell_size_m = cell_size_m

    # ================================================================
    # Yihang JSON → arc_core models
    # ================================================================

    def json_to_scenario(self, data: dict) -> DisasterScenario:
        """Convert Yihang's scenario JSON to a DisasterScenario."""
        map_data = data.get("map", {})
        grid_size = map_data.get("size", [30, 30])

        # Parse victims → Survivors
        survivors = []
        for v in data.get("victims", []):
            loc = v.get("location", [0, 0])
            survivors.append(Survivor(
                survivor_id=v["id"],
                position=Coordinate3D(
                    x=loc[0] * self.cell_size_m,
                    y=loc[1] * self.cell_size_m,
                    z=0,
                ),
                status="trapped" if v.get("status") == "trapped" else v.get("status", "unknown"),
                trapped_duration_min=0,
                injury_severity=1.0 - (v.get("hp", 10000) / 10000.0),
                vital_signs={
                    "thermal": v.get("thermal_signal", 0) > 0.3,
                    "sound": v.get("audio_signal", 0) > 0.3,
                    "vibration": v.get("vibration_signal", 0) > 0.3,
                },
                group_size=1,
            ))

        # Parse infrastructure
        blocked = map_data.get("blocked_cells", [])
        risk_zones = map_data.get("risk_zones", [])
        infra = InfrastructureStatus(
            roads_blocked=[
                {"road_id": b["id"], "severity": b.get("repair_cost", 50) / 100.0}
                for b in blocked if b.get("status") == "blocked"
            ],
            buildings_collapsed=[
                {
                    "building_id": z["id"],
                    "position": {"x": z["center"][0] * self.cell_size_m, "y": z["center"][1] * self.cell_size_m},
                    "collapse_pct": z.get("risk", 0.5),
                }
                for z in risk_zones
            ],
            communication_status="full_outage" if map_data.get("communication_dead_zones") else "partial_outage",
        )

        center_x = grid_size[0] * self.cell_size_m / 2
        center_y = grid_size[1] * self.cell_size_m / 2

        return DisasterScenario(
            scenario_id=data.get("scenario_id", "unknown"),
            timestamp="",
            disaster_type=DisasterType.EARTHQUAKE,
            disaster_severity=0.7,
            affected_area_center=Coordinate3D(x=center_x, y=center_y, z=0),
            affected_area_radius_km=(grid_size[0] * self.cell_size_m) / 1000.0,
            survivors=survivors,
            infrastructure=infra,
        )

    def json_to_agents(self, data: dict) -> List[EdgeAgent]:
        """Convert Yihang's agent list to EdgeAgent instances."""
        agents = []
        comm = data.get("communication", {})
        for a in data.get("agents", []):
            # Map agent type string to arc_core AgentType
            # Supports canonical ("ugv","uav","balloon") and legacy ("drone", "ground_*")
            raw_type = str(a.get("type", "")).lower()
            if raw_type == "balloon":
                agent_type = AgentType.BALLOON
            elif raw_type == "ugv" or "ground" in raw_type:
                agent_type = AgentType.UGV
            elif raw_type in ("uav", "drone") or raw_type.startswith("drone"):
                agent_type = AgentType.UAV
            else:
                agent_type = AgentType.UAV

            altitude = {
                AgentType.BALLOON: 200.0,
                AgentType.UAV: 50.0,
                AgentType.UGV: 0.0,
            }[agent_type]

            loc = a.get("location", [0, 0])
            agent = EdgeAgent(
                agent_type=agent_type,
                position=Coordinate3D(
                    x=loc[0] * self.cell_size_m,
                    y=loc[1] * self.cell_size_m,
                    z=altitude,
                ),
                agent_id=a["id"],
            )
            agent.battery_level = a.get("battery", 100) / 100.0
            agent.max_speed_mps = a.get("speed", 1) * self.cell_size_m
            default_comm_cells = {
                AgentType.BALLOON: max(
                    a.get("perception_range", 12),
                    comm.get("relay_range", 8),
                ),
                AgentType.UAV: comm.get("direct_comm_range", 4),
                AgentType.UGV: comm.get("base_range", 12),
            }[agent_type]
            agent.comm_range_m = a.get("comm_range", default_comm_cells) * self.cell_size_m

            # Map role to task
            role = a.get("role", "")
            if role == "scout":
                agent.current_task = AgentTask.RECON
            elif role == "relay":
                agent.current_task = AgentTask.RELAY
            elif role == "rescue":
                agent.current_task = AgentTask.RESCUE
            elif role == "clear_blockade":
                agent.current_task = AgentTask.TRANSPORT
            else:
                agent.current_task = AgentTask.IDLE

            agents.append(agent)
        return agents

    # ================================================================
    # arc_core models → Yihang-compatible JSON
    # ================================================================

    def plan_to_yihang_json(
        self,
        agents: List[EdgeAgent],
        survivors: List[Survivor],
        assignments: Dict[str, str],
        briefing: str,
        rescue_log: List[dict],
    ) -> dict:
        """
        Convert arc_core's decision output to a JSON structure
        compatible with Yihang's app.js renderPanels() expectations.
        """
        # Build mission_plan actions in Yihang's format
        mission_plan = []
        for agent_id, task_desc in assignments.items():
            agent = next((a for a in agents if a.agent_id == agent_id), None)
            if not agent:
                continue

            action = {
                "agent": agent_id,
                "task": self._map_task_to_yihang(agent.current_task),
                "target": self._extract_target(task_desc),
                "safety_note": f"ARC Decision Hub: {task_desc}",
            }
            mission_plan.append(action)

        # Build priority_order from survivors
        priority_order = [s.survivor_id for s in survivors if s.status in ("trapped", "unknown")]

        # Build ranked candidates in Yihang's format
        candidates = []
        for s in survivors:
            if s.status in ("trapped", "unknown"):
                survival_score = 1.0 - s.injury_severity
                candidates.append({
                    "id": s.survivor_id,
                    "score": round(survival_score, 2),
                    "hp": int((1.0 - s.injury_severity) * 10000),
                    "survival_steps": round(survival_score * 200, 1),
                    "life_signal_confidence": round(
                        sum(1 for v in s.vital_signs.values() if v) / max(len(s.vital_signs), 1), 2
                    ),
                    "status": s.status,
                })

        return {
            "commander_briefing": briefing,
            "priority_order": priority_order,
            "mission_plan": mission_plan,
            "human_confirmation_required": [
                "ARC autonomous decision — no human confirmation required.",
            ],
            "arc_metadata": {
                "decision_source": "arc_core",
                "agents": [a.to_dict() for a in agents],
                "rescue_log": rescue_log[-10:],  # Last 10 entries
            },
        }

    def _map_task_to_yihang(self, task: AgentTask) -> str:
        """Map arc_core AgentTask to Yihang's task strings."""
        mapping = {
            AgentTask.RECON: "aerial_confirmation",
            AgentTask.SEARCH: "aerial_confirmation",
            AgentTask.RESCUE: "vibration_audio_verification",
            AgentTask.RELAY: "deploy_relay",
            AgentTask.TRANSPORT: "clear_blockade",
            AgentTask.CHARGE: "recharge",
        }
        return mapping.get(task, "patrol")

    def _extract_target(self, task_desc: str) -> str:
        """Extract target ID from task description string."""
        # e.g. "search_survivor_V1" → "V1", "rescue_survivor_V2" → "V2"
        parts = task_desc.split("_")
        for part in reversed(parts):
            if part.startswith("V") or part.startswith("K") or part.startswith("Relay"):
                return part
        return task_desc

    # ================================================================
    # Sync Yihang state updates back to arc_core
    # ================================================================

    def sync_state_from_frontend(
        self,
        frontend_state: dict,
        agents: List[EdgeAgent],
        survivors: List[Survivor],
    ):
        """
        Update arc_core agent positions and survivor status
        from the frontend's current state after a step.
        """
        # Sync agent positions and battery
        for fa in frontend_state.get("agents", []):
            agent = next((a for a in agents if a.agent_id == fa["id"]), None)
            if agent:
                loc = fa.get("location", [0, 0])
                agent.position = Coordinate3D(
                    x=loc[0] * self.cell_size_m,
                    y=loc[1] * self.cell_size_m,
                    z=agent.position.z,
                )
                agent.battery_level = fa.get("battery", 100) / 100.0

        # Sync victim status
        for fv in frontend_state.get("victims", []):
            survivor = next((s for s in survivors if s.survivor_id == fv["id"]), None)
            if survivor:
                survivor.status = fv.get("status", survivor.status)
