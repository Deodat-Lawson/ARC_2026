"""
API Output — Interface to Timmy's Landing Page

Generates structured JSON output from A.R.C. system state for display
on the React Landing Page.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional

from arc_core.agents.edge_agent import EdgeAgent
from arc_core.agents.decision_hub import DecisionHub
from arc_core.state_machine import ConnectivityStateMachine

logger = logging.getLogger(__name__)


class APIOutput:
    """
    Serializes the entire A.R.C. system state into a JSON structure
    consumable by Timmy's React Landing Page.
    
    Output format:
    {
        "timestamp": "...",
        "system_state": "edge_only" | "cloud_edge",
        "fleet_status": [...],
        "rescue_priorities": [...],
        "decision_hubs": [...],
        "rescue_log": [...],
        "energy_summary": {...},
        "communication_topology": {...}
    }
    """

    def generate_snapshot(
        self,
        state_machine: ConnectivityStateMachine,
        agents: List[EdgeAgent],
        hubs: List[DecisionHub],
        rescue_priorities: Optional[List[Dict]] = None,
    ) -> dict:
        """Generate a complete system snapshot."""
        snapshot = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "system_state": state_machine.current_state.value,
            "fleet_status": [a.to_dict() for a in agents],
            "rescue_priorities": rescue_priorities or [],
            "decision_hubs": [h.to_dict() for h in hubs],
            "rescue_log": self._collect_rescue_logs(hubs),
            "energy_summary": self._energy_summary(agents),
            "fleet_summary": {
                "total_agents": len(agents),
                "active_agents": sum(
                    1 for a in agents if a.health_status.value != "offline"
                ),
                "total_hubs": len(hubs),
                "avg_battery": round(
                    sum(a.battery_level for a in agents) / max(len(agents), 1), 3
                ),
            },
        }
        return snapshot

    def save_snapshot(self, snapshot: dict, filepath: str):
        """Save snapshot to a JSON file for Timmy's frontend."""
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2, ensure_ascii=False)
        logger.info(f"Snapshot saved to {filepath}")

    def _collect_rescue_logs(self, hubs: List[DecisionHub]) -> List[dict]:
        """Aggregate rescue logs from all hubs, sorted by time."""
        all_logs = []
        for hub in hubs:
            all_logs.extend(entry.to_dict() for entry in hub.rescue_log)
        all_logs.sort(key=lambda x: x.get("time", 0))
        return all_logs

    def _energy_summary(self, agents: List[EdgeAgent]) -> dict:
        """Summary of fleet energy state."""
        if not agents:
            return {}
        batteries = [a.battery_level for a in agents]
        return {
            "avg_battery": round(sum(batteries) / len(batteries), 3),
            "min_battery": round(min(batteries), 3),
            "max_battery": round(max(batteries), 3),
            "critical_count": sum(1 for b in batteries if b < 0.1),
            "solar_capable": sum(1 for a in agents if a.solar_recharge_rate > 0),
        }
