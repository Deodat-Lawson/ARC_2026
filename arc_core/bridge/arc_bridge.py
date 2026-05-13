"""
ARC Bridge Server — FastAPI backend connecting arc_core to Yihang's 2D Demo

Endpoints:
  POST /api/init     — Initialize arc_core from scenario JSON
  POST /api/step     — Execute one decision step, return plan
  GET  /api/state    — Get current system state
  GET  /api/rescue_log — Get accumulated rescue log

Run:
  cd D:\\3rd_semester\\ARC_2026
  python -m arc_core.bridge.arc_bridge
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from arc_core.config import AgentType, SystemMode, DEFAULT_CONFIG
from arc_core.state_machine import ConnectivityStateMachine
from arc_core.agents.agent_types import Coordinate3D, Survivor
from arc_core.agents.edge_agent import EdgeAgent
from arc_core.agents.decision_hub import DecisionHub
from arc_core.interfaces.api_output import APIOutput
from arc_core.bridge.scenario_adapter import ScenarioAdapter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ARC.Bridge")


# ============================================================================
# Global State (single simulation instance)
# ============================================================================

class ARCBridgeState:
    """Holds the entire arc_core simulation state."""

    def __init__(self):
        self.adapter = ScenarioAdapter()
        self.state_machine = ConnectivityStateMachine()
        self.agents: List[EdgeAgent] = []
        self.survivors: List[Survivor] = []
        self.hubs: List[DecisionHub] = []
        self.api_output = APIOutput()
        self.timestep: int = 0
        self.rescued_count: int = 0
        self.initialized: bool = False
        self._raw_scenario: dict = {}

    def init_from_scenario(self, scenario_json: dict):
        """Initialize all arc_core state from Yihang's scenario JSON."""
        self._raw_scenario = scenario_json

        # Parse scenario
        scenario = self.adapter.json_to_scenario(scenario_json)
        self.survivors = scenario.survivors

        # Parse agents
        self.agents = self.adapter.json_to_agents(scenario_json)

        # Set system mode based on communication
        comm = scenario_json.get("communication", {})
        dead_zones = scenario_json.get("map", {}).get("communication_dead_zones", [])
        if dead_zones:
            self.state_machine.force_mode(SystemMode.EDGE_ONLY, "Communication dead zones detected")
        else:
            self.state_machine.force_mode(SystemMode.CLOUD_EDGE, "Network available")

        # Discover peers and attempt hub formation
        for agent in self.agents:
            agent.comm_range_m = 9999  # In simulation, all agents can reach each other
            agent.discover_peers(self.agents)

        self._try_form_hubs()
        self.timestep = 0
        self.rescued_count = 0
        self.initialized = True

        logger.info(
            f"ARC Bridge initialized: {len(self.agents)} agents, "
            f"{len(self.survivors)} survivors, {len(self.hubs)} hubs"
        )

    def step(self, frontend_state: dict) -> dict:
        """
        Execute one decision step:
        1. Sync state from frontend
        2. Run arc_core decision algorithms
        3. Return Yihang-compatible plan JSON
        """
        if not self.initialized:
            return {"error": "Not initialized. Call /api/init first."}

        self.timestep += 1

        # Sync positions and status from frontend
        self.adapter.sync_state_from_frontend(frontend_state, self.agents, self.survivors)

        # Update rescued count
        self.rescued_count = sum(1 for s in self.survivors if s.status == "rescued")

        # Re-discover peers and re-form hubs if needed
        for agent in self.agents:
            agent.discover_peers(self.agents)
        self._try_form_hubs()

        # Generate decision via hub or individual agents
        assignments, briefing = self._generate_decision(frontend_state)

        # Collect rescue logs
        all_logs = []
        for hub in self.hubs:
            all_logs.extend(entry.to_dict() for entry in hub.rescue_log)

        # Convert to Yihang-compatible format
        plan = self.adapter.plan_to_yihang_json(
            agents=self.agents,
            survivors=self.survivors,
            assignments=assignments,
            briefing=briefing,
            rescue_log=all_logs,
        )

        plan["arc_metadata"]["timestep"] = self.timestep
        plan["arc_metadata"]["system_mode"] = self.state_machine.current_state.value
        plan["arc_metadata"]["hubs"] = [h.to_dict() for h in self.hubs]

        return plan

    def _generate_decision(self, frontend_state: dict) -> tuple:
        """
        Run arc_core's decision algorithm.
        Returns (assignments_dict, briefing_string).
        """
        active_survivors = [s for s in self.survivors if s.status in ("trapped", "unknown")]

        if not active_survivors:
            return {}, "All known victim sites resolved. Maintaining perimeter scan."

        # If we have hubs, use hub-level task allocation
        if self.hubs:
            hub = self.hubs[0]  # Primary hub
            assignments = hub.allocate_tasks(active_survivors)

            # Energy management
            hub.allocate_energy()

            # Evaluate sacrifice
            sacrifice = hub.evaluate_sacrifice()
            if sacrifice:
                logger.info(f"Hub decided to sacrifice {sacrifice} for fleet efficiency")

            # Generate briefing
            top_survivor = active_survivors[0] if active_survivors else None
            briefing = self._make_briefing(top_survivor, assignments, frontend_state)

            return assignments, briefing
        else:
            # Individual agent decisions (fallback)
            assignments = {}
            for i, agent in enumerate(self.agents):
                if i < len(active_survivors):
                    target = active_survivors[i]
                    task_name = "search" if agent.agent_type == AgentType.UAV else "rescue"
                    assignments[agent.agent_id] = f"{task_name}_survivor_{target.survivor_id}"
                else:
                    assignments[agent.agent_id] = "area_reconnaissance"

            briefing = "Operating in individual mode — no Decision Hub formed."
            return assignments, briefing

    def _make_briefing(self, top_survivor: Optional[Survivor], assignments: dict, frontend_state: dict) -> str:
        """Generate a commander briefing string."""
        if not top_survivor:
            return "No active survivors detected. Maintaining search pattern."

        active_count = sum(1 for s in self.survivors if s.status in ("trapped", "unknown"))
        rescued = sum(1 for s in self.survivors if s.status == "rescued")

        # Check communication status from Yihang's data
        dead_zones = self._raw_scenario.get("map", {}).get("communication_dead_zones", [])
        comm_note = ""
        if dead_zones:
            comm_note = " Communication dead zones detected — deploying relay drone for coverage."

        # Assess victim urgency
        urgency = "critical" if top_survivor.injury_severity > 0.5 else "moderate"

        briefing = (
            f"[ARC Decision Hub | Step {self.timestep}] "
            f"{top_survivor.survivor_id} is the current priority target "
            f"(injury severity: {urgency}, "
            f"life signals: {sum(1 for v in top_survivor.vital_signs.values() if v)}/3 active). "
            f"{active_count} survivors remaining, {rescued} rescued so far. "
            f"Fleet operating in {self.state_machine.current_state.value} mode."
            f"{comm_note} "
            f"Assigned {len(assignments)} agents to active tasks."
        )
        return briefing

    def _try_form_hubs(self):
        """Attempt to form Decision Hubs from available agents."""
        # Only form hubs if we don't have any yet
        if self.hubs:
            return

        available = [a for a in self.agents if not a.is_in_hub]
        if len(available) >= DEFAULT_CONFIG.hub.min_agents_for_hub:
            try:
                hub = DecisionHub(available)
                self.hubs.append(hub)
                logger.info(f"Decision Hub {hub.hub_id} formed with {len(available)} agents")
            except ValueError:
                pass

    def get_state_snapshot(self) -> dict:
        """Get current state for /api/state endpoint."""
        return self.api_output.generate_snapshot(
            state_machine=self.state_machine,
            agents=self.agents,
            hubs=self.hubs,
        )


# Global state instance
bridge_state = ARCBridgeState()


# ============================================================================
# FastAPI Application
# ============================================================================

def create_app():
    """Create and configure the FastAPI application."""
    try:
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware
        from pydantic import BaseModel
    except ImportError:
        logger.error("FastAPI not installed. Run: pip install fastapi uvicorn")
        sys.exit(1)

    app = FastAPI(
        title="ARC Bridge Server",
        description="Connects arc_core decision engine to Yihang's 2D Demo",
        version="0.1.0",
    )

    # Allow CORS for local frontend
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def root():
        return {
            "service": "ARC Bridge Server",
            "status": "running",
            "initialized": bridge_state.initialized,
            "timestep": bridge_state.timestep,
        }

    @app.post("/api/init")
    def init_scenario(scenario: dict):
        """Initialize arc_core from Yihang's scenario JSON."""
        bridge_state.init_from_scenario(scenario)
        return {
            "status": "initialized",
            "agents": len(bridge_state.agents),
            "survivors": len(bridge_state.survivors),
            "hubs": len(bridge_state.hubs),
            "system_mode": bridge_state.state_machine.current_state.value,
        }

    @app.post("/api/step")
    def step(state: dict):
        """Execute one decision step. Receives current frontend state, returns plan."""
        plan = bridge_state.step(state)
        return plan

    @app.get("/api/state")
    def get_state():
        """Get current arc_core system state."""
        if not bridge_state.initialized:
            return {"error": "Not initialized"}
        return bridge_state.get_state_snapshot()

    @app.get("/api/rescue_log")
    def get_rescue_log():
        """Get accumulated rescue log from all hubs."""
        all_logs = []
        for hub in bridge_state.hubs:
            all_logs.extend(entry.to_dict() for entry in hub.rescue_log)
        return {"rescue_log": all_logs, "count": len(all_logs)}

    return app


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    try:
        import uvicorn
    except ImportError:
        print("ERROR: uvicorn not installed. Run: pip install fastapi uvicorn")
        sys.exit(1)

    print("=" * 60)
    print("  ARC Bridge Server")
    print("  Connecting arc_core → Yihang's 2D Demo")
    print("  http://localhost:8000")
    print("  Docs: http://localhost:8000/docs")
    print("=" * 60)

    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
