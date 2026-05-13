"""
EdgeAgent — Individual Unmanned Vehicle Intelligence

Each physical vehicle (UGV/UAV/Balloon) runs one EdgeAgent instance with
a local Gemma 4 model. The agent perceives, decides, communicates, and
can auto-join groups to form DecisionHubs.

Implements the "tentacle" in the Octopus Brain architecture.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Dict, List, Optional

from arc_core.config import (
    AgentCapabilities,
    AgentTask,
    AgentType,
    HealthStatus,
    DEFAULT_CONFIG,
)
from arc_core.agents.agent_types import (
    AgentAction,
    Coordinate3D,
    Message,
    SensorData,
    VitalSignal,
)

if TYPE_CHECKING:
    from arc_core.agents.decision_hub import DecisionHub

logger = logging.getLogger(__name__)


class EdgeAgent:
    """
    Individual unmanned vehicle agent with local Gemma 4 intelligence.
    
    Lifecycle:
        1. perceive() — gather sensor data
        2. decide()   — local decision via Gemma 4 (or mock)
        3. execute()  — carry out the chosen action
        4. communicate() — exchange messages with peers
        5. should_form_group() — check if hub formation is warranted
    """

    def __init__(
        self,
        agent_type: AgentType,
        position: Optional[Coordinate3D] = None,
        agent_id: Optional[str] = None,
    ):
        self.agent_id = agent_id or f"{agent_type.value}-{str(uuid.uuid4())[:6]}"
        self.agent_type = agent_type
        self.position = position or Coordinate3D()
        self.battery_level: float = 1.0
        self.health_status = HealthStatus.NOMINAL
        self.current_task = AgentTask.IDLE
        self.payload_kg: float = 0.0

        # Load type-specific capabilities from config
        caps = DEFAULT_CONFIG.agent_capabilities.get(agent_type)
        self.max_speed_mps: float = caps["max_speed_mps"]
        self.max_payload_kg: float = caps["max_payload_kg"]
        self.battery_drain_per_min: float = caps["battery_drain_per_min"]
        self.comm_range_m: float = caps["comm_range_m"]
        self.can_charge_others: bool = caps["can_charge_others"]
        self.solar_recharge_rate: float = caps["solar_recharge_rate"]
        self.gemma_model: str = caps["gemma_model"]

        # Communication
        self._inbox: List[Message] = []
        self._outbox: List[Message] = []
        self._known_peers: Dict[str, EdgeAgent] = {}

        # Hub membership
        self.hub: Optional[DecisionHub] = None
        self._sensor_history: List[SensorData] = []

    # -- Properties ----------------------------------------------------------

    @property
    def is_in_hub(self) -> bool:
        return self.hub is not None

    @property
    def compute_power(self) -> float:
        """Relative compute power: E4B=1.0, E2B=0.5."""
        return 1.0 if self.gemma_model == "E4B" else 0.5

    @property
    def leader_score(self) -> float:
        """Composite score for hub leader election."""
        w = DEFAULT_CONFIG.hub.leader_score_weights
        return (
            w["battery"] * self.battery_level
            + w["compute_power"] * self.compute_power
            + w["comm_capability"] * (self.comm_range_m / 5000.0)
        )

    # -- Core Lifecycle ------------------------------------------------------

    def perceive(self) -> SensorData:
        """
        Gather sensor data from the environment.
        In simulation mode, returns mock data. In production, interfaces
        with actual sensor hardware + LingBot-Map.
        """
        data = SensorData(
            agent_id=self.agent_id,
            timestamp=time.time(),
            position=Coordinate3D(self.position.x, self.position.y, self.position.z),
        )
        self._sensor_history.append(data)
        return data

    def decide(self, sensor_data: SensorData) -> Optional[AgentAction]:
        """
        Local decision-making via Gemma 4 (mock implementation).
        
        Decision logic:
        1. If vital signals detected → prioritize rescue
        2. If low battery → return to UGV for charging
        3. Otherwise → continue assigned task
        """
        # Priority 1: Life signal detected
        if sensor_data.vital_signals:
            best_signal = max(sensor_data.vital_signals, key=lambda v: v.confidence)
            if best_signal.confidence > 0.5:
                logger.info(
                    f"[{self.agent_id}] Life signal detected! "
                    f"Confidence={best_signal.confidence:.2f} at {best_signal.position.to_dict()}"
                )
                return AgentAction(
                    action_type="search",
                    target_position=best_signal.position,
                    parameters={"signal": best_signal.to_dict()},
                    priority=10,
                )

        # Priority 2: Low battery
        if self.battery_level < 0.15 and self.agent_type != AgentType.UGV:
            logger.warning(f"[{self.agent_id}] Low battery ({self.battery_level:.1%}), seeking charge")
            return AgentAction(
                action_type="charge",
                priority=8,
            )

        # Default: continue current task
        return None

    def execute(self, action: AgentAction) -> dict:
        """
        Execute a physical action. Updates internal state.
        Returns execution result.
        """
        result = {
            "agent_id": self.agent_id,
            "action": action.action_type,
            "success": True,
            "timestamp": time.time(),
        }

        if action.action_type == "move_to" and action.target_position:
            self.position = action.target_position
            self.current_task = AgentTask.TRANSPORT

        elif action.action_type == "search":
            self.current_task = AgentTask.SEARCH
            if action.target_position:
                self.position = action.target_position

        elif action.action_type == "relay":
            self.current_task = AgentTask.RELAY

        elif action.action_type == "charge":
            self.current_task = AgentTask.CHARGE

        elif action.action_type == "deploy_balloon":
            self.current_task = AgentTask.DEPLOY_BALLOON

        # Drain battery for this tick
        self._drain_battery()
        return result

    def _drain_battery(self):
        """Simulate battery consumption per time step."""
        drain = self.battery_drain_per_min * (DEFAULT_CONFIG.simulation.tick_duration_sec / 60.0)
        self.battery_level = max(0.0, self.battery_level - drain)

        # Solar recharge (partial)
        if self.solar_recharge_rate > 0:
            recharge = self.solar_recharge_rate * (DEFAULT_CONFIG.simulation.tick_duration_sec / 60.0)
            self.battery_level = min(1.0, self.battery_level + recharge)

        # Update health
        if self.battery_level <= 0.0:
            self.health_status = HealthStatus.OFFLINE
        elif self.battery_level < 0.1:
            self.health_status = HealthStatus.CRITICAL
        elif self.battery_level < 0.25:
            self.health_status = HealthStatus.DEGRADED

    # -- Communication -------------------------------------------------------

    def send_message(self, receiver: EdgeAgent, msg_type: str, payload: dict):
        """Send a message to another agent within comm range."""
        distance = self.position.distance_to(receiver.position)
        if distance > self.comm_range_m:
            logger.debug(
                f"[{self.agent_id}] Cannot reach {receiver.agent_id} "
                f"(distance={distance:.0f}m > range={self.comm_range_m:.0f}m)"
            )
            return False

        msg = Message(
            sender_id=self.agent_id,
            receiver_id=receiver.agent_id,
            msg_type=msg_type,
            payload=payload,
            timestamp=time.time(),
        )
        receiver.receive_message(msg)
        self._outbox.append(msg)
        return True

    def receive_message(self, msg: Message):
        """Receive a message from another agent."""
        self._inbox.append(msg)

    def get_pending_messages(self) -> List[Message]:
        """Retrieve and clear the inbox."""
        messages = list(self._inbox)
        self._inbox.clear()
        return messages

    # -- Group Formation -----------------------------------------------------

    def discover_peers(self, all_agents: List[EdgeAgent]):
        """Discover agents within communication range."""
        self._known_peers.clear()
        for agent in all_agents:
            if agent.agent_id == self.agent_id:
                continue
            if self.position.distance_to(agent.position) <= self.comm_range_m:
                self._known_peers[agent.agent_id] = agent

    def should_form_group(self) -> bool:
        """
        Check if conditions are met for hub formation:
        - At least min_agents_for_hub peers nearby (including self)
        - None of them already in a hub
        """
        available = [
            p for p in self._known_peers.values()
            if not p.is_in_hub and p.health_status != HealthStatus.OFFLINE
        ]
        # +1 for self
        return (len(available) + 1) >= DEFAULT_CONFIG.hub.min_agents_for_hub and not self.is_in_hub

    def get_groupable_peers(self) -> List[EdgeAgent]:
        """Return peers eligible for group formation."""
        return [
            p for p in self._known_peers.values()
            if not p.is_in_hub and p.health_status != HealthStatus.OFFLINE
        ]

    # -- Serialization -------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "id": self.agent_id,
            "type": self.agent_type.value,
            "battery": round(self.battery_level, 3),
            "health": self.health_status.value,
            "task": self.current_task.value,
            "position": self.position.to_dict(),
            "in_hub": self.hub.hub_id if self.hub else None,
            "gemma_model": self.gemma_model,
        }
