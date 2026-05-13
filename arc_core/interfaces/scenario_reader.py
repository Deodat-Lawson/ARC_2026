"""
Scenario Reader — Interface to Yihang's Stanford Generative Agents

Reads disaster scenario data (JSON) from Yihang's simulation output.
Supports both file-based and in-memory scenario loading.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from arc_core.config import DisasterType
from arc_core.agents.agent_types import Coordinate3D, Survivor

logger = logging.getLogger(__name__)


@dataclass
class InfrastructureStatus:
    """Status of infrastructure in the disaster zone."""
    roads_blocked: List[Dict] = field(default_factory=list)
    buildings_collapsed: List[Dict] = field(default_factory=list)
    communication_status: str = "full_outage"  # "operational", "partial_outage", "full_outage"


@dataclass
class DisasterScenario:
    """
    Complete disaster scenario — the primary input to the A.R.C. system.
    Produced by Yihang's Stanford Generative Agents simulation.
    """
    scenario_id: str = ""
    timestamp: str = ""
    disaster_type: DisasterType = DisasterType.EARTHQUAKE
    disaster_severity: float = 0.5         # 0.0 ~ 1.0
    affected_area_center: Coordinate3D = field(default_factory=Coordinate3D)
    affected_area_radius_km: float = 1.0
    survivors: List[Survivor] = field(default_factory=list)
    infrastructure: InfrastructureStatus = field(default_factory=InfrastructureStatus)
    weather: Dict = field(default_factory=lambda: {
        "temperature_c": 15.0,
        "humidity_pct": 70.0,
        "wind_speed_mps": 5.0,
        "precipitation_mmh": 0.0,
    })
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "scenario_id": self.scenario_id,
            "timestamp": self.timestamp,
            "disaster_type": self.disaster_type.value,
            "disaster_severity": self.disaster_severity,
            "affected_area": {
                "center": self.affected_area_center.to_dict(),
                "radius_km": self.affected_area_radius_km,
            },
            "survivors": [s.to_dict() for s in self.survivors],
            "infrastructure": {
                "roads_blocked": self.infrastructure.roads_blocked,
                "buildings_collapsed": self.infrastructure.buildings_collapsed,
                "communication_status": self.infrastructure.communication_status,
            },
            "weather": self.weather,
        }


class ScenarioReader:
    """
    Reads and parses disaster scenarios from JSON.
    
    Usage:
        reader = ScenarioReader()
        scenario = reader.load_from_file("path/to/scenario.json")
        # or
        scenario = reader.load_from_dict(json_dict)
    """

    def load_from_file(self, filepath: str) -> DisasterScenario:
        """Load scenario from a JSON file."""
        path = Path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"Scenario file not found: {filepath}")

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        logger.info(f"Loaded scenario from {filepath}")
        return self.load_from_dict(data)

    def load_from_dict(self, data: dict) -> DisasterScenario:
        """Parse scenario from a dictionary (e.g., from API or WebSocket)."""
        # Parse survivors
        survivors = []
        for s in data.get("survivors", []):
            loc = s.get("location", {})
            survivors.append(Survivor(
                survivor_id=s.get("id", ""),
                position=Coordinate3D(
                    x=loc.get("x", loc.get("lat", 0)),
                    y=loc.get("y", loc.get("lng", 0)),
                    z=loc.get("z", loc.get("depth_m", 0)),
                ),
                status=s.get("status", "unknown"),
                trapped_duration_min=s.get("trapped_duration_min", 0),
                estimated_age=s.get("age"),
                injury_severity=s.get("injury_severity", 0),
                vital_signs=s.get("vital_signs", {}),
                group_size=s.get("group_size", 1),
            ))

        # Parse affected area
        area = data.get("affected_area", {})
        center = area.get("center", {})

        # Parse infrastructure
        infra_data = data.get("infrastructure", {})
        infra = InfrastructureStatus(
            roads_blocked=infra_data.get("roads_blocked", []),
            buildings_collapsed=infra_data.get("buildings_collapsed", []),
            communication_status=infra_data.get("communication_status", "full_outage"),
        )

        # Parse disaster type
        try:
            disaster_type = DisasterType(data.get("disaster_type", "earthquake"))
        except ValueError:
            disaster_type = DisasterType.EARTHQUAKE

        scenario = DisasterScenario(
            scenario_id=data.get("scenario_id", "unknown"),
            timestamp=data.get("timestamp", ""),
            disaster_type=disaster_type,
            disaster_severity=data.get("disaster_severity", 0.5),
            affected_area_center=Coordinate3D(
                x=center.get("x", center.get("lat", 0)),
                y=center.get("y", center.get("lng", 0)),
                z=center.get("z", 0),
            ),
            affected_area_radius_km=area.get("radius_km", 1.0),
            survivors=survivors,
            infrastructure=infra,
            weather=data.get("weather", {}),
            metadata=data.get("metadata", {}),
        )

        logger.info(
            f"Parsed scenario '{scenario.scenario_id}': "
            f"{scenario.disaster_type.value}, severity={scenario.disaster_severity}, "
            f"{len(survivors)} survivors"
        )
        return scenario
