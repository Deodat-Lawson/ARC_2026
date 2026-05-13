"""
Agent Type Definitions & Shared Data Models

Defines Coordinate3D, SensorData, and type-specific capability profiles
used by EdgeAgent and DecisionHub.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from arc_core.config import AgentType, AgentTask, HealthStatus


# ============================================================================
# Spatial Data Models
# ============================================================================

@dataclass
class Coordinate3D:
    """3D position (lat/lng/altitude or local x/y/z in meters)."""
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0  # Altitude in meters (0 = ground level)

    def distance_to(self, other: Coordinate3D) -> float:
        """Euclidean distance in 3D space."""
        return math.sqrt(
            (self.x - other.x) ** 2
            + (self.y - other.y) ** 2
            + (self.z - other.z) ** 2
        )

    def distance_2d(self, other: Coordinate3D) -> float:
        """Ground-plane distance (ignoring altitude)."""
        return math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2)

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "z": self.z}

    @classmethod
    def from_dict(cls, d: dict) -> Coordinate3D:
        return cls(x=d.get("x", 0), y=d.get("y", 0), z=d.get("z", 0))


# ============================================================================
# Sensor & Perception Data
# ============================================================================

@dataclass
class VitalSignal:
    """A detected life signal from sensors."""
    signal_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    position: Coordinate3D = field(default_factory=Coordinate3D)
    confidence: float = 0.0           # 0.0 ~ 1.0
    signal_type: str = "unknown"      # "heartbeat", "vibration", "acoustic", "thermal"
    strength: float = 0.0             # Raw signal strength
    timestamp: float = 0.0

    def to_dict(self) -> dict:
        return {
            "signal_id": self.signal_id,
            "position": self.position.to_dict(),
            "confidence": self.confidence,
            "signal_type": self.signal_type,
            "strength": self.strength,
            "timestamp": self.timestamp,
        }


@dataclass
class EnvironmentReading:
    """Environmental sensor data at a specific location."""
    position: Coordinate3D = field(default_factory=Coordinate3D)
    temperature_c: float = 20.0
    humidity_pct: float = 50.0
    air_quality_aqi: float = 50.0     # Air Quality Index
    enclosure_level: float = 0.0      # 0 = open, 1 = fully enclosed
    obstacle_distance_m: float = 100.0
    timestamp: float = 0.0


@dataclass
class SensorData:
    """Aggregated sensor reading from an agent at a given time step."""
    agent_id: str = ""
    timestamp: float = 0.0
    position: Coordinate3D = field(default_factory=Coordinate3D)
    vital_signals: List[VitalSignal] = field(default_factory=list)
    environment: Optional[EnvironmentReading] = None
    camera_frame: Optional[Any] = None   # Placeholder for image data / LingBot-Map input
    raw_readings: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "timestamp": self.timestamp,
            "position": self.position.to_dict(),
            "vital_signals": [v.to_dict() for v in self.vital_signals],
            "environment": {
                "temperature_c": self.environment.temperature_c,
                "humidity_pct": self.environment.humidity_pct,
                "air_quality_aqi": self.environment.air_quality_aqi,
            } if self.environment else None,
        }


# ============================================================================
# Survivor Model (from scenario input)
# ============================================================================

@dataclass
class Survivor:
    """A person detected or known to need rescue."""
    survivor_id: str = ""
    position: Coordinate3D = field(default_factory=Coordinate3D)
    status: str = "unknown"             # "trapped", "injured", "mobile", "rescued"
    trapped_duration_min: float = 0.0
    estimated_age: Optional[int] = None
    injury_severity: float = 0.0        # 0 = none, 1 = critical
    vital_signs: Dict[str, bool] = field(default_factory=dict)
    group_size: int = 1                 # Number of people at this location

    def to_dict(self) -> dict:
        return {
            "survivor_id": self.survivor_id,
            "position": self.position.to_dict(),
            "status": self.status,
            "trapped_duration_min": self.trapped_duration_min,
            "injury_severity": self.injury_severity,
            "group_size": self.group_size,
        }


# ============================================================================
# Action / Command Models
# ============================================================================

@dataclass
class AgentAction:
    """A concrete action to be executed by an agent."""
    action_type: str           # "move_to", "scan_area", "deploy_balloon", "relay", "charge"
    target_position: Optional[Coordinate3D] = None
    target_agent_id: Optional[str] = None
    parameters: Dict[str, Any] = field(default_factory=dict)
    priority: int = 0          # Higher = more urgent


@dataclass
class Message:
    """Inter-agent or agent-hub communication message."""
    sender_id: str = ""
    receiver_id: str = ""       # "" = broadcast
    msg_type: str = "info"      # "info", "request", "command", "alert", "heartbeat"
    payload: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = 0.0
