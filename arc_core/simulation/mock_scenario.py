"""
Mock Scenario Generator

Generates realistic disaster scenarios for testing the A.R.C. system
without requiring Yihang's Stanford Generative Agents.
"""

from __future__ import annotations

import json
import random
import time
from pathlib import Path
from typing import List

from arc_core.config import DisasterType
from arc_core.agents.agent_types import Coordinate3D, Survivor
from arc_core.interfaces.scenario_reader import DisasterScenario, InfrastructureStatus
from arc_core.paths import SIMULATION_DATA_DIR


def generate_earthquake_scenario(
    num_survivors: int = 5,
    severity: float = 0.7,
    seed: int = 42,
) -> DisasterScenario:
    """
    Generate a realistic earthquake disaster scenario.
    
    Args:
        num_survivors: Number of trapped survivors
        severity: Disaster severity 0.0~1.0
        seed: Random seed for reproducibility
    """
    rng = random.Random(seed)

    # Affected area: ~2km radius
    center = Coordinate3D(x=2500.0, y=2500.0, z=0.0)

    # Generate survivors at various locations
    survivors = []
    for i in range(num_survivors):
        # Scatter survivors within the affected area
        angle = rng.uniform(0, 6.28)
        dist = rng.uniform(100, 1500)
        import math
        sx = center.x + dist * math.cos(angle)
        sy = center.y + dist * math.sin(angle)
        depth = -rng.uniform(0.5, 8.0)  # Buried depth (negative = underground)

        survivors.append(Survivor(
            survivor_id=f"person_{i+1:02d}",
            position=Coordinate3D(x=round(sx, 1), y=round(sy, 1), z=round(depth, 1)),
            status="trapped",
            trapped_duration_min=rng.uniform(10, 180),
            estimated_age=rng.choice([25, 35, 45, 55, 65, 75]),
            injury_severity=round(rng.uniform(0, 1), 2),
            vital_signs={
                "heartbeat": rng.random() > 0.1,
                "movement": rng.random() > 0.5,
                "sound": rng.random() > 0.3,
                "thermal": rng.random() > 0.2,
            },
            group_size=rng.choice([1, 1, 1, 2, 3]),
        ))

    # Infrastructure damage
    num_blocked_roads = int(severity * 10)
    num_collapsed = int(severity * 8)
    infra = InfrastructureStatus(
        roads_blocked=[
            {"road_id": f"road_{i}", "severity": round(rng.uniform(0.3, 1.0), 2)}
            for i in range(num_blocked_roads)
        ],
        buildings_collapsed=[
            {
                "building_id": f"bldg_{i}",
                "position": Coordinate3D(
                    x=center.x + rng.uniform(-1000, 1000),
                    y=center.y + rng.uniform(-1000, 1000),
                ).to_dict(),
                "collapse_pct": round(rng.uniform(0.2, 1.0), 2),
            }
            for i in range(num_collapsed)
        ],
        communication_status="full_outage" if severity > 0.6 else "partial_outage",
    )

    scenario = DisasterScenario(
        scenario_id=f"earthquake_{int(time.time())}",
        timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        disaster_type=DisasterType.EARTHQUAKE,
        disaster_severity=severity,
        affected_area_center=center,
        affected_area_radius_km=2.5,
        survivors=survivors,
        infrastructure=infra,
        weather={
            "temperature_c": rng.uniform(5, 25),
            "humidity_pct": rng.uniform(40, 90),
            "wind_speed_mps": rng.uniform(0, 15),
            "precipitation_mmh": rng.uniform(0, 20) if rng.random() > 0.5 else 0,
        },
        metadata={"generator": "mock", "seed": seed},
    )

    return scenario


def save_scenario(scenario: DisasterScenario, filepath: str):
    """Save a scenario to JSON file."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(scenario.to_dict(), f, indent=2, ensure_ascii=False)
    print(f"Scenario saved to {filepath}")


# ============================================================================
# CLI Entry Point
# ============================================================================

if __name__ == "__main__":
    scenario = generate_earthquake_scenario(num_survivors=5, severity=0.7)
    save_scenario(
        scenario,
        str(SIMULATION_DATA_DIR / "earthquake_demo.json"),
    )
    print(f"Generated scenario: {scenario.scenario_id}")
    print(f"  Disaster: {scenario.disaster_type.value} (severity={scenario.disaster_severity})")
    print(f"  Survivors: {len(scenario.survivors)}")
    print(f"  Blocked roads: {len(scenario.infrastructure.roads_blocked)}")
    print(f"  Collapsed buildings: {len(scenario.infrastructure.buildings_collapsed)}")
