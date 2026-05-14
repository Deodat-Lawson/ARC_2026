"""
A.R.C. End-to-End Demo — Phase 1 Skeleton Validation

Demonstrates the complete pipeline:
1. Load disaster scenario (mock)
2. Initialize fleet (UGV + UAV + Balloon)
3. State machine manages connectivity
4. Agents discover peers and form DecisionHub
5. Hub allocates tasks and manages energy
6. System outputs JSON snapshot for Landing Page

Run from repository root:
    python -m arc_core.runners
"""

import logging

from arc_core.config import AgentType, SystemMode, DEFAULT_CONFIG
from arc_core.state_machine import ConnectivityStateMachine
from arc_core.agents.agent_types import Coordinate3D
from arc_core.agents.edge_agent import EdgeAgent
from arc_core.agents.decision_hub import DecisionHub
from arc_core.interfaces.api_output import APIOutput
from arc_core.paths import SIMULATION_DATA_DIR
from arc_core.simulation.mock_scenario import generate_earthquake_scenario, save_scenario

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
    print("\n[1/7] Step 1: Generating earthquake scenario...")
    scenario = generate_earthquake_scenario(num_survivors=5, severity=0.7)

    save_scenario(
        scenario,
        str(SIMULATION_DATA_DIR / "earthquake_demo.json"),
    )

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
    print("\n[2/7] Step 2: Initializing connectivity state machine...")
    state_machine = ConnectivityStateMachine()

    if scenario.infrastructure.communication_status == "full_outage":
        state_machine.force_mode(SystemMode.EDGE_ONLY, "Disaster caused full comm outage")
    else:
        state_machine.force_mode(SystemMode.CLOUD_EDGE, "Partial connectivity available")

    print(f"   System mode: {state_machine.current_state.value}")

    # ----------------------------------------------------------------
    # Step 3: Deploy fleet
    # ----------------------------------------------------------------
    print("\n[3/7] Step 3: Deploying heterogeneous fleet...")
    center = scenario.affected_area_center

    ugv_offsets = [
        (-400, -400), (  0, -400), ( 400, -400), (-400, 0),
        (   0,    0), ( 400,    0), (-400, 400), (   0, 400),
    ]
    uav_offsets = [
        (-300, -200), (   0, -300), ( 300, -200), (-400,  100),
        ( 400,  100), (-200,  300), ( 200,  300), (   0,  400),
        (-350, -350), ( 350, -350), (-350,  350), ( 350,  350),
        (-150,    0), ( 150,    0), (   0,    0),
    ]
    bal_offsets = [
        (-600, -600), (-200, -600), ( 200, -600), ( 600, -600), (1000, -600),
        (-600, -200), (-200, -200), ( 200, -200), ( 600, -200), (1000, -200),
        (-600,  200), (-200,  200), ( 200,  200), ( 600,  200), (1000,  200),
        (-600,  600), (-200,  600), ( 200,  600), ( 600,  600), (1000,  600),
    ]

    agents = (
        [EdgeAgent(AgentType.UGV,     Coordinate3D(center.x + dx, center.y + dy, 0),   f"UGV-{i+1}")
         for i, (dx, dy) in enumerate(ugv_offsets)]
        +
        [EdgeAgent(AgentType.UAV,     Coordinate3D(center.x + dx, center.y + dy, 50),  f"UAV-{i+1}")
         for i, (dx, dy) in enumerate(uav_offsets)]
        +
        [EdgeAgent(AgentType.BALLOON, Coordinate3D(center.x + dx, center.y + dy, 200), f"BAL-{i+1}")
         for i, (dx, dy) in enumerate(bal_offsets)]
    )

    print(f"   Power: 2 x 50kW diesel generators online")

    for a in agents:
        print(f"   {a.agent_id}: {a.agent_type.value} at ({a.position.x:.0f}, {a.position.y:.0f}, {a.position.z:.0f})")

    # ----------------------------------------------------------------
    # Step 4: Peer discovery and hub formation
    # ----------------------------------------------------------------
    print("\n[4/7] Step 4: Peer discovery & DecisionHub formation...")

    for agent in agents:
        agent.discover_peers(agents)
        peers = list(agent._known_peers.keys())
        print(f"   {agent.agent_id} found {len(peers)} peers in range")

    hubs = []
    formed_agents = set()

    for agent in agents:
        if agent.agent_id in formed_agents or agent.is_in_hub:
            continue
        if agent.should_form_group():
            group_members = [agent] + agent.get_groupable_peers()
            group_members = group_members[:5]
            hub = DecisionHub(group_members)
            hubs.append(hub)
            for m in group_members:
                formed_agents.add(m.agent_id)
            print(f"   OK {hub.hub_id} formed: {[m.agent_id for m in group_members]} "
                  f"(Leader: {hub.leader.agent_id})")

    if not hubs:
        print("   WARN: No hubs formed (agents may be out of range)")

    for i, hub in enumerate(hubs):
        for j, other in enumerate(hubs):
            if i != j:
                hub.register_peer_hub(other)

    # ----------------------------------------------------------------
    # Step 5: Task allocation
    # ----------------------------------------------------------------
    print("\n[5/7] Step 5: Task allocation for survivors...")

    for hub in hubs:
        assignments = hub.allocate_tasks(scenario.survivors)
        for agent_id, task in assignments.items():
            print(f"   {agent_id} -> {task}")

    # ----------------------------------------------------------------
    # Step 6: Energy management
    # ----------------------------------------------------------------
    print("\n[6/7] Step 6: Energy management...")

    for agent in agents:
        if agent.agent_type == AgentType.UAV:
            agent.battery_level = 0.20

    for hub in hubs:
        transfers = hub.allocate_energy()
        if transfers:
            for t in transfers:
                print(f"   Energy {t['from']} -> {t['to']}: {t['amount']:.1%} battery")
        else:
            print(f"   [{hub.hub_id}] No energy transfers needed")

    # ----------------------------------------------------------------
    # Step 7: Generate output for Landing Page
    # ----------------------------------------------------------------
    print("\n[7/7] Step 7: Generating Landing Page output...")

    api = APIOutput()
    snapshot = api.generate_snapshot(
        state_machine=state_machine,
        agents=agents,
        hubs=hubs,
        rescue_priorities=[
            {
                "survivor_id": s.survivor_id,
                "survival_score": round(1.0 - s.injury_severity, 2),
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

    if snapshot["rescue_log"]:
        print("\nRescue Log:")
        for entry in snapshot["rescue_log"][:10]:
            print(f"   [{entry['hub_id']}] {entry['event']} -> {entry['action']}")

    print("\n" + "=" * 70)
    print("  Done: Phase 1 Demo Complete — Skeleton pipeline verified")
    print("=" * 70)


if __name__ == "__main__":
    main()
