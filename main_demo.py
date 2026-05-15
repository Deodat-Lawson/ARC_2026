"""
A.R.C. End-to-End Demo — Phase 1 Skeleton Validation

Demonstrates the complete pipeline:
1. Load disaster scenario (mock)
2. Initialize fleet (UGV + UAV + Balloon)
3. State machine manages connectivity
4. Agents discover peers and form DecisionHub
5. Hub allocates tasks and manages energy
6. System outputs JSON snapshot for Landing Page
"""

import json
import logging
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from arc_core.config import AgentType, SystemMode, DEFAULT_CONFIG
from arc_core.state_machine import ConnectivityStateMachine
from arc_core.agents.agent_types import Coordinate3D
from arc_core.agents.edge_agent import EdgeAgent
from arc_core.agents.decision_hub import DecisionHub
from arc_core.interfaces.scenario_reader import ScenarioReader
from arc_core.interfaces.api_output import APIOutput
from arc_core.paths import SIMULATION_DATA_DIR
from arc_core.simulation.mock_scenario import generate_earthquake_scenario, save_scenario

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ARC.Demo")


def main():
    print("=" * 70)
    print("  A.R.C. (Autonomous Rescue Cluster) — Phase 1 Demo")
    print("  章鱼脑架构 · 异构无人集群 · 灾后自动救援")
    print("=" * 70)

    # ----------------------------------------------------------------
    # Step 1: Generate and load disaster scenario
    # ----------------------------------------------------------------
    print("\n📋 Step 1: Generating earthquake scenario...")
    scenario = generate_earthquake_scenario(num_survivors=5, severity=0.7)
    
    # Also save to file for reference
    save_scenario(scenario, str(SIMULATION_DATA_DIR / "earthquake_demo.json"))

    print(f"   Scenario ID: {scenario.scenario_id}")
    print(f"   Disaster: {scenario.disaster_type.value} (severity={scenario.disaster_severity})")
    print(f"   Survivors: {len(scenario.survivors)}")
    for s in scenario.survivors:
        signs = [k for k, v in s.vital_signs.items() if v]
        print(f"     - {s.survivor_id}: trapped {s.trapped_duration_min:.0f}min, "
              f"injury={s.injury_severity:.2f}, signs={signs}")

    # ----------------------------------------------------------------
    # Step 2: Initialize state machine
    # ----------------------------------------------------------------
    print("\n📡 Step 2: Initializing connectivity state machine...")
    state_machine = ConnectivityStateMachine()
    
    # Simulate network loss (disaster scenario → full outage)
    if scenario.infrastructure.communication_status == "full_outage":
        state_machine.force_mode(SystemMode.EDGE_ONLY, "Disaster caused full comm outage")
    else:
        state_machine.force_mode(SystemMode.CLOUD_EDGE, "Partial connectivity available")
    
    print(f"   System mode: {state_machine.current_state.value}")

    # ----------------------------------------------------------------
    # Step 3: Deploy fleet
    # ----------------------------------------------------------------
    print("\n🚀 Step 3: Deploying heterogeneous fleet...")
    center = scenario.affected_area_center
    
    agents = [
        # 2 UGVs — ground vehicles, power hubs
        EdgeAgent(AgentType.UGV, Coordinate3D(center.x - 200, center.y, 0), "UGV-1"),
        EdgeAgent(AgentType.UGV, Coordinate3D(center.x + 300, center.y + 200, 0), "UGV-2"),
        # 4 UAVs — aerial recon
        EdgeAgent(AgentType.UAV, Coordinate3D(center.x, center.y - 100, 50), "UAV-1"),
        EdgeAgent(AgentType.UAV, Coordinate3D(center.x + 100, center.y + 100, 50), "UAV-2"),
        EdgeAgent(AgentType.UAV, Coordinate3D(center.x - 150, center.y + 200, 50), "UAV-3"),
        EdgeAgent(AgentType.UAV, Coordinate3D(center.x + 200, center.y - 200, 50), "UAV-4"),
        # 2 Balloons — aerostat monitoring
        EdgeAgent(AgentType.BALLOON, Coordinate3D(center.x, center.y, 200), "BAL-1"),
        EdgeAgent(AgentType.BALLOON, Coordinate3D(center.x + 500, center.y + 500, 200), "BAL-2"),
    ]

    for a in agents:
        print(f"   {a.agent_id}: {a.agent_type.value} at ({a.position.x:.0f}, {a.position.y:.0f}, {a.position.z:.0f})")

    # ----------------------------------------------------------------
    # Step 4: Peer discovery and hub formation
    # ----------------------------------------------------------------
    print("\n🔗 Step 4: Peer discovery & DecisionHub formation...")
    
    # All agents discover peers
    for agent in agents:
        agent.discover_peers(agents)
        peers = list(agent._known_peers.keys())
        print(f"   {agent.agent_id} found {len(peers)} peers in range")

    # Attempt hub formation
    hubs = []
    formed_agents = set()

    for agent in agents:
        if agent.agent_id in formed_agents or agent.is_in_hub:
            continue
        if agent.should_form_group():
            group_members = [agent] + agent.get_groupable_peers()
            # Take first min_agents_for_hub members
            group_members = group_members[:5]  # Cap at 5 per hub
            hub = DecisionHub(group_members)
            hubs.append(hub)
            for m in group_members:
                formed_agents.add(m.agent_id)
            print(f"   ✅ {hub.hub_id} formed: {[m.agent_id for m in group_members]} "
                  f"(Leader: {hub.leader.agent_id})")

    if not hubs:
        print("   ⚠️ No hubs formed (agents may be out of range)")

    # Register peer hubs
    for i, hub in enumerate(hubs):
        for j, other in enumerate(hubs):
            if i != j:
                hub.register_peer_hub(other)

    # ----------------------------------------------------------------
    # Step 5: Task allocation
    # ----------------------------------------------------------------
    print("\n📌 Step 5: Task allocation for survivors...")
    
    for hub in hubs:
        assignments = hub.allocate_tasks(scenario.survivors)
        for agent_id, task in assignments.items():
            print(f"   {agent_id} → {task}")

    # ----------------------------------------------------------------
    # Step 6: Energy management
    # ----------------------------------------------------------------
    print("\n🔋 Step 6: Energy management...")
    
    # Simulate some UAVs with low battery
    for agent in agents:
        if agent.agent_type == AgentType.UAV:
            agent.battery_level = 0.20  # Simulate drain

    for hub in hubs:
        transfers = hub.allocate_energy()
        if transfers:
            for t in transfers:
                print(f"   ⚡ {t['from']} → {t['to']}: {t['amount']:.1%} battery")
        else:
            print(f"   [{hub.hub_id}] No energy transfers needed")

    # ----------------------------------------------------------------
    # Step 7: Generate output for Landing Page
    # ----------------------------------------------------------------
    print("\n📤 Step 7: Generating Landing Page output...")
    
    api = APIOutput()
    snapshot = api.generate_snapshot(
        state_machine=state_machine,
        agents=agents,
        hubs=hubs,
        rescue_priorities=[
            {
                "survivor_id": s.survivor_id,
                "survival_score": round(1.0 - s.injury_severity, 2),  # Placeholder scoring
                "assigned_agents": [],
                "eta_minutes": 0,
            }
            for s in scenario.survivors
        ],
    )

    output_path = str(SIMULATION_DATA_DIR / "arc_output_snapshot.json")
    api.save_snapshot(snapshot, output_path)
    
    print(f"   Snapshot saved to: {output_path}")
    print(f"   Fleet: {snapshot['fleet_summary']['active_agents']}/{snapshot['fleet_summary']['total_agents']} active")
    print(f"   Hubs: {snapshot['fleet_summary']['total_hubs']}")
    print(f"   Avg battery: {snapshot['fleet_summary']['avg_battery']:.1%}")
    print(f"   Rescue log entries: {len(snapshot['rescue_log'])}")

    # Print rescue log
    if snapshot["rescue_log"]:
        print("\n📝 Rescue Log:")
        for entry in snapshot["rescue_log"][:10]:
            print(f"   [{entry['hub_id']}] {entry['event']} → {entry['action']}")

    print("\n" + "=" * 70)
    print("  ✅ Phase 1 Demo Complete — Skeleton pipeline verified")
    print("=" * 70)


if __name__ == "__main__":
    main()
