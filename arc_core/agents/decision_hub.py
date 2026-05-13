"""
DecisionHub — Cluster Brain (≥3 agents auto-formed)

When 3+ EdgeAgents are in communication range and not already in a hub,
they auto-elect a leader and form a DecisionHub. The hub has authority
over its members and can coordinate tasks, allocate energy, and even
sacrifice individual agents for overall rescue efficiency.

Implements the "brain" in the Octopus Brain architecture.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from arc_core.config import DEFAULT_CONFIG, AgentTask, AgentType
from arc_core.agents.agent_types import Coordinate3D, Survivor
from arc_core.agents.edge_agent import EdgeAgent

logger = logging.getLogger(__name__)


@dataclass
class RescueLogEntry:
    """A single entry in the rescue decision log."""
    timestamp: float
    hub_id: str
    event: str
    action: str
    details: Dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "time": self.timestamp,
            "hub_id": self.hub_id,
            "event": self.event,
            "action": self.action,
            "details": self.details,
        }


class DecisionHub:
    """
    Autonomous decision center formed by ≥3 nearby agents.
    
    Responsibilities:
    - Task allocation across members
    - Energy/power management (UGV as mobile charging station)
    - Sacrifice decisions (abandon low-value agent for fleet benefit)
    - Inter-hub coordination (peer-to-peer, decentralized)
    - Rescue log generation for post-analysis
    """

    def __init__(self, members: List[EdgeAgent], hub_id: Optional[str] = None):
        if len(members) < DEFAULT_CONFIG.hub.min_agents_for_hub:
            raise ValueError(
                f"DecisionHub requires at least {DEFAULT_CONFIG.hub.min_agents_for_hub} "
                f"agents, got {len(members)}"
            )

        self.hub_id = hub_id or f"hub-{str(uuid.uuid4())[:6]}"
        self._members: Dict[str, EdgeAgent] = {}
        self._leader_id: str = ""
        self._peer_hubs: Dict[str, DecisionHub] = {}
        self._rescue_log: List[RescueLogEntry] = []
        self._active_plan: str = "initializing"
        self._step_thinking: List[str] = []

        # Register members and elect leader
        for agent in members:
            self.add_member(agent)
        self._elect_leader()

        self._log_event("Hub formed", f"Members: {[a.agent_id for a in members]}")
        self._think(
            f"Decision Hub [{self.hub_id}] 已组建，成员: "
            f"{[a.agent_id for a in members]}，"
            f"领袖选举: {self._leader_id}。"
        )
        logger.info(
            f"DecisionHub [{self.hub_id}] formed with {len(members)} agents. "
            f"Leader: {self._leader_id}"
        )

    # -- Properties ----------------------------------------------------------

    @property
    def members(self) -> List[EdgeAgent]:
        return list(self._members.values())

    @property
    def leader(self) -> Optional[EdgeAgent]:
        return self._members.get(self._leader_id)

    @property
    def member_count(self) -> int:
        return len(self._members)

    @property
    def center_position(self) -> Coordinate3D:
        """Geographic center of all members."""
        if not self._members:
            return Coordinate3D()
        xs = [a.position.x for a in self._members.values()]
        ys = [a.position.y for a in self._members.values()]
        zs = [a.position.z for a in self._members.values()]
        n = len(self._members)
        return Coordinate3D(sum(xs) / n, sum(ys) / n, sum(zs) / n)

    @property
    def total_battery(self) -> float:
        """Average battery across all members."""
        if not self._members:
            return 0.0
        return sum(a.battery_level for a in self._members.values()) / len(self._members)

    @property
    def rescue_log(self) -> List[RescueLogEntry]:
        return list(self._rescue_log)

    # -- Member Management ---------------------------------------------------

    def add_member(self, agent: EdgeAgent):
        """Add an agent to this hub."""
        self._members[agent.agent_id] = agent
        agent.hub = self

    def remove_member(self, agent_id: str) -> Optional[EdgeAgent]:
        """Remove an agent from this hub."""
        agent = self._members.pop(agent_id, None)
        if agent:
            agent.hub = None
        return agent

    # -- Per-step Thinking Log -----------------------------------------------

    def begin_step(self):
        """Clear thinking buffer at the start of each simulation step."""
        self._step_thinking = []

    def _think(self, msg: str):
        """Append one reasoning entry to this step's thinking log."""
        self._step_thinking.append(msg)

    def get_thinking_log_for_step(self) -> str:
        """Return the full reasoning chain for this step as a single string."""
        return " ".join(self._step_thinking)

    # -- Leader Election -----------------------------------------------------

    def _elect_leader(self):
        """
        Elect the hub leader based on composite score:
          score = w_battery * battery + w_compute * compute + w_comm * comm_range
        
        UGVs naturally score higher (E4B model, higher battery, larger comm range).
        """
        if not self._members:
            return

        best_agent = max(self._members.values(), key=lambda a: a.leader_score)
        self._leader_id = best_agent.agent_id
        logger.debug(f"[{self.hub_id}] Leader elected: {self._leader_id} (score={best_agent.leader_score:.3f})")

    # -- Task Allocation -----------------------------------------------------

    def allocate_tasks(self, survivors: List[Survivor]) -> Dict[str, str]:
        """
        Assign rescue tasks to members based on survivor priorities and agent capabilities.
        
        Strategy:
        - UAVs → recon & search (fast, aerial view)
        - UGVs → transport & rescue (heavy payload)
        - Balloons → relay & monitoring (wide-area, long endurance)
        
        Returns: {agent_id: task_description}
        """
        assignment: Dict[str, str] = {}
        self._active_plan = f"rescue_{len(survivors)}_survivors"

        uavs = [a for a in self._members.values() if a.agent_type == AgentType.UAV]
        ugvs = [a for a in self._members.values() if a.agent_type == AgentType.UGV]
        balloons = [a for a in self._members.values() if a.agent_type == AgentType.BALLOON]

        # Balloons → always relay/monitor
        for b in balloons:
            b.current_task = AgentTask.RELAY
            assignment[b.agent_id] = "communication_relay_and_monitoring"
            self._think(f"{b.agent_id}(气球)已部署通信中继，覆盖范围扩大。")

        # Assign survivors to available UAVs and UGVs
        available_uavs = list(uavs)
        available_ugvs = list(ugvs)

        for i, survivor in enumerate(survivors):
            severity_pct = int(survivor.injury_severity * 100)
            # UAV scouts first
            if available_uavs:
                scout = available_uavs.pop(0)
                scout.current_task = AgentTask.SEARCH
                assignment[scout.agent_id] = f"search_survivor_{survivor.survivor_id}"
                self._think(
                    f"检测到{survivor.survivor_id}，伤势{severity_pct}%，"
                    f"指派{scout.agent_id}(UAV)执行空中侦察确认。"
                )
                self._log_event(
                    f"Detected survivor {survivor.survivor_id}",
                    f"Assigned {scout.agent_id} (UAV) to search",
                )

            # UGV follows for rescue
            if available_ugvs:
                rescuer = available_ugvs.pop(0)
                rescuer.current_task = AgentTask.RESCUE
                assignment[rescuer.agent_id] = f"rescue_survivor_{survivor.survivor_id}"
                self._think(
                    f"指派{rescuer.agent_id}(UGV)地面推进救援{survivor.survivor_id}。"
                )
                self._log_event(
                    f"Rescue plan for {survivor.survivor_id}",
                    f"Assigned {rescuer.agent_id} (UGV) to rescue",
                )

        # Remaining idle agents
        for agent in self._members.values():
            if agent.agent_id not in assignment:
                agent.current_task = AgentTask.RECON
                assignment[agent.agent_id] = "area_reconnaissance"

        return assignment

    # -- Energy Management ---------------------------------------------------

    def allocate_energy(self) -> List[Dict]:
        """
        Manage energy across the fleet.
        UGVs with solar panels act as mobile charging stations.
        
        Returns list of energy transfer events.
        """
        transfers = []
        chargers = [a for a in self._members.values() if a.can_charge_others and a.battery_level > 0.5]
        needers = [
            a for a in self._members.values()
            if not a.can_charge_others and a.battery_level < 0.25
        ]

        for needer in needers:
            if not chargers:
                break
            # Find nearest charger
            charger = min(chargers, key=lambda c: c.position.distance_to(needer.position))
            transfer_amount = min(0.2, charger.battery_level - 0.3)  # Keep charger above 30%
            if transfer_amount > 0:
                charger.battery_level -= transfer_amount
                needer.battery_level = min(1.0, needer.battery_level + transfer_amount)
                event = {
                    "from": charger.agent_id,
                    "to": needer.agent_id,
                    "amount": round(transfer_amount, 3),
                }
                transfers.append(event)
                self._think(
                    f"{charger.agent_id}电量{charger.battery_level:.0%}，"
                    f"为{needer.agent_id}补充{transfer_amount:.0%}电量"
                    f"({int((needer.battery_level - transfer_amount)*100)}%→{int(needer.battery_level*100)}%)。"
                )
                self._log_event(
                    f"Energy transfer: {charger.agent_id} → {needer.agent_id}",
                    f"Transferred {transfer_amount:.1%} battery",
                )

        return transfers

    # -- Sacrifice Decision --------------------------------------------------

    def evaluate_sacrifice(self) -> Optional[str]:
        """
        Evaluate whether sacrificing one agent would improve overall efficiency
        by more than the configured threshold (default 30%).
        
        Candidates: agents with lowest battery that are NOT leaders or UGVs.
        
        Returns agent_id to sacrifice, or None.
        """
        threshold = DEFAULT_CONFIG.hub.sacrifice_efficiency_threshold
        candidates = [
            a for a in self._members.values()
            if a.agent_id != self._leader_id
            and a.agent_type != AgentType.UGV  # Never sacrifice the power hub
            and a.battery_level < 0.15
        ]

        if not candidates:
            return None

        weakest = min(candidates, key=lambda a: a.battery_level)
        # Simple efficiency model: sacrificing a near-dead agent frees resources
        current_avg_battery = self.total_battery
        hypothetical_members = [a for a in self._members.values() if a.agent_id != weakest.agent_id]
        if not hypothetical_members:
            return None
        hypothetical_avg = sum(a.battery_level for a in hypothetical_members) / len(hypothetical_members)
        efficiency_gain = (hypothetical_avg - current_avg_battery) / max(current_avg_battery, 0.01)

        if efficiency_gain >= threshold:
            self._think(
                f"{weakest.agent_id}电量{weakest.battery_level:.0%}已触底，"
                f"牺牲效率增益{efficiency_gain:.0%}>{threshold:.0%}阈值，"
                f"执行牺牲协议，为集群整体效率让路。"
            )
            self._log_event(
                f"Sacrifice decision: {weakest.agent_id}",
                f"Efficiency gain: {efficiency_gain:.1%} (threshold: {threshold:.1%})",
            )
            weakest.current_task = AgentTask.SACRIFICED
            self.remove_member(weakest.agent_id)
            return weakest.agent_id

        return None

    # -- Inter-Hub Coordination ----------------------------------------------

    def register_peer_hub(self, peer: DecisionHub):
        """Register another hub for inter-hub coordination."""
        self._peer_hubs[peer.hub_id] = peer

    def coordinate_with_peers(self) -> List[Dict]:
        """
        Exchange status with peer hubs for redundancy and joint planning.
        Returns coordination events.
        """
        events = []
        for peer_id, peer in self._peer_hubs.items():
            event = {
                "local_hub": self.hub_id,
                "peer_hub": peer_id,
                "local_battery": round(self.total_battery, 3),
                "peer_battery": round(peer.total_battery, 3),
                "local_members": self.member_count,
                "peer_members": peer.member_count,
            }
            events.append(event)
        return events

    # -- Logging -------------------------------------------------------------

    def _log_event(self, event: str, action: str, details: Dict = None):
        entry = RescueLogEntry(
            timestamp=time.time(),
            hub_id=self.hub_id,
            event=event,
            action=action,
            details=details or {},
        )
        self._rescue_log.append(entry)

    # -- Serialization -------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "hub_id": self.hub_id,
            "leader": self._leader_id,
            "members": [a.agent_id for a in self._members.values()],
            "member_count": self.member_count,
            "avg_battery": round(self.total_battery, 3),
            "center_position": self.center_position.to_dict(),
            "active_plan": self._active_plan,
            "peer_hubs": list(self._peer_hubs.keys()),
            "rescue_log_count": len(self._rescue_log),
        }
