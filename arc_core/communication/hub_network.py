"""
HubNetwork — Decentralised Decision Hub Mesh

Implements peer-to-peer broadcast and majority-vote consensus
for inter-hub coordination (the "octopus brain ↔ brain" layer).

Architecture reference: swarm-workflows/SwarmAgents
  — their PBFT consensus engine for multi-agent agreement
  — adapted to ARC's heterogeneous, battery-constrained scenario

In simulation mode all communication is in-process (zero latency).
Production replacement: swap _deliver() for a mesh radio / websocket call.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================================
# Message Types
# ============================================================================

class MsgType:
    STATUS       = "status"          # Periodic heartbeat / status broadcast
    TASK_REQUEST = "task_request"    # Hub requesting help from peer
    SACRIFICE_VOTE = "sacrifice_vote"  # Vote on whether to abandon an agent
    MERGE_REQUEST  = "merge_request"   # Propose merging two hubs
    SURVIVOR_FOUND = "survivor_found"  # Alert: new survivor detected
    ENERGY_SHARE   = "energy_share"    # UGV offering charge to peer hub


@dataclass
class HubMessage:
    """A single inter-hub message."""
    msg_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    sender_hub_id: str = ""
    receiver_hub_id: str = ""   # "" = broadcast to all
    msg_type: str = MsgType.STATUS
    payload: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    requires_ack: bool = False

    def to_dict(self) -> dict:
        return {
            "msg_id": self.msg_id,
            "from": self.sender_hub_id,
            "to": self.receiver_hub_id or "ALL",
            "type": self.msg_type,
            "payload": self.payload,
            "ts": round(self.timestamp, 2),
        }


# ============================================================================
# Consensus Record
# ============================================================================

@dataclass
class ConsensusRecord:
    """Tracks votes on a single proposal (PBFT-lite majority vote)."""
    proposal_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    proposal_type: str = ""      # e.g. "sacrifice", "merge"
    subject: str = ""            # agent_id or hub_id in question
    votes: Dict[str, bool] = field(default_factory=dict)   # hub_id → yes/no
    required_majority: float = 0.51
    resolved: bool = False
    outcome: Optional[bool] = None

    def cast_vote(self, hub_id: str, vote: bool):
        self.votes[hub_id] = vote
        self._try_resolve()

    def _try_resolve(self):
        if not self.votes:
            return
        yes = sum(1 for v in self.votes.values() if v)
        total = len(self.votes)
        if yes / total >= self.required_majority:
            self.resolved = True
            self.outcome = True
        elif (total - yes) / total > (1 - self.required_majority):
            self.resolved = True
            self.outcome = False

    def to_dict(self) -> dict:
        return {
            "proposal_id": self.proposal_id,
            "type": self.proposal_type,
            "subject": self.subject,
            "votes": self.votes,
            "resolved": self.resolved,
            "outcome": self.outcome,
        }


# ============================================================================
# Hub Network
# ============================================================================

class HubNetwork:
    """
    Decentralised mesh network connecting all DecisionHubs.

    Reference: SwarmAgents (swarm-workflows/SwarmAgents)
      - broadcast + PBFT-lite consensus
      - node failure handling
      - modular resource allocation logic
    ARC additions:
      - battery-aware priority (low-power hubs get priority responses)
      - survivor_found alert propagation
      - rescue log aggregation across all hubs
    """

    def __init__(self):
        self._hubs: Dict[str, Any] = {}              # hub_id → DecisionHub
        self._message_log: List[HubMessage] = []
        self._consensus_table: Dict[str, ConsensusRecord] = {}
        self._listeners: List[Callable[[HubMessage], None]] = []
        self._tick: int = 0

    # -- Hub Registration ------------------------------------------------

    def register_hub(self, hub) -> None:
        """Register a DecisionHub with the network."""
        self._hubs[hub.hub_id] = hub
        # Auto-connect new hub as peer to existing hubs
        for existing_hub in self._hubs.values():
            if existing_hub.hub_id != hub.hub_id:
                existing_hub.register_peer_hub(hub)
                hub.register_peer_hub(existing_hub)
        logger.info(f"HubNetwork: registered {hub.hub_id} (total hubs: {len(self._hubs)})")

    def deregister_hub(self, hub_id: str) -> None:
        """Remove a hub (e.g. after battery depletion)."""
        self._hubs.pop(hub_id, None)
        for hub in self._hubs.values():
            hub._peer_hubs.pop(hub_id, None)
        logger.info(f"HubNetwork: deregistered {hub_id}")

    # -- Broadcast -------------------------------------------------------

    def broadcast(
        self,
        sender_hub_id: str,
        msg_type: str,
        payload: Dict[str, Any],
        receiver_hub_id: str = "",
    ) -> HubMessage:
        """
        Broadcast a message to all hubs (or a specific hub).
        In simulation mode, delivery is synchronous and in-process.
        Reference: SwarmAgents broadcast mechanism.
        """
        msg = HubMessage(
            sender_hub_id=sender_hub_id,
            receiver_hub_id=receiver_hub_id,
            msg_type=msg_type,
            payload=payload,
        )
        self._message_log.append(msg)
        self._deliver(msg)

        for cb in self._listeners:
            try:
                cb(msg)
            except Exception as e:
                logger.warning(f"HubNetwork listener error: {e}")

        return msg

    def _deliver(self, msg: HubMessage):
        """
        Deliver message to target hub(s).
        Production: replace with mesh radio / asyncio websocket send.
        """
        targets = (
            [self._hubs[msg.receiver_hub_id]]
            if msg.receiver_hub_id and msg.receiver_hub_id in self._hubs
            else [h for hid, h in self._hubs.items() if hid != msg.sender_hub_id]
        )
        for hub in targets:
            self._handle_incoming(hub, msg)

    def _handle_incoming(self, hub, msg: HubMessage):
        """Process incoming message at the receiving hub."""
        if msg.msg_type == MsgType.SURVIVOR_FOUND:
            # Log the survivor alert for the receiving hub
            hub._log_event(
                f"Peer alert: survivor found by {msg.sender_hub_id}",
                f"Survivor ID: {msg.payload.get('survivor_id', '?')}",
                msg.payload
            )
        elif msg.msg_type == MsgType.SACRIFICE_VOTE:
            proposal_id = msg.payload.get("proposal_id")
            if proposal_id and proposal_id in self._consensus_table:
                # Auto-vote: distant hubs are more likely to approve sacrifice
                auto_vote = hub.hub_id != msg.sender_hub_id
                self._consensus_table[proposal_id].cast_vote(hub.hub_id, auto_vote)

    # -- Consensus (PBFT-lite) -------------------------------------------

    def propose_sacrifice(self, proposer_hub_id: str, agent_id: str) -> ConsensusRecord:
        """
        Initiate a network-wide vote on whether to sacrifice an agent.
        Reference: SwarmAgents PBFT consensus engine.

        Hubs other than the proposer auto-approve (they don't have
        stake in the sacrificed agent). The proposer's hub also votes yes
        (it already ran local evaluate_sacrifice() before calling this).
        """
        record = ConsensusRecord(
            proposal_type="sacrifice",
            subject=agent_id,
        )
        self._consensus_table[record.proposal_id] = record

        # Proposer always votes yes (already decided locally)
        record.cast_vote(proposer_hub_id, True)

        # Broadcast for other hubs to vote
        self.broadcast(
            sender_hub_id=proposer_hub_id,
            msg_type=MsgType.SACRIFICE_VOTE,
            payload={"proposal_id": record.proposal_id, "agent_id": agent_id},
        )

        logger.info(
            f"HubNetwork: sacrifice proposal {record.proposal_id} for {agent_id} "
            f"| resolved={record.resolved} outcome={record.outcome}"
        )
        return record

    def propose_merge(self, hub_a_id: str, hub_b_id: str) -> ConsensusRecord:
        """Propose merging two hubs to consolidate resources."""
        record = ConsensusRecord(
            proposal_type="merge",
            subject=f"{hub_a_id}+{hub_b_id}",
        )
        self._consensus_table[record.proposal_id] = record
        record.cast_vote(hub_a_id, True)
        self.broadcast(
            sender_hub_id=hub_a_id,
            msg_type=MsgType.MERGE_REQUEST,
            payload={"proposal_id": record.proposal_id, "hub_b": hub_b_id},
            receiver_hub_id=hub_b_id,
        )
        return record

    # -- Network-wide Status Sync ----------------------------------------

    def sync_all(self) -> List[dict]:
        """
        Collect status snapshots from all hubs.
        Used for: rescue log aggregation, timeline.json generation,
        Gemma 4 cloud summary when connectivity restored.
        """
        self._tick += 1
        snapshots = []
        for hub_id, hub in self._hubs.items():
            snap = hub.to_dict()
            snap["network_tick"] = self._tick
            snap["thinking_log"] = hub.get_thinking_log_for_step()
            snapshots.append(snap)

            # Auto-broadcast status to peers every sync
            self.broadcast(
                sender_hub_id=hub_id,
                msg_type=MsgType.STATUS,
                payload=snap,
            )
        return snapshots

    def alert_survivor_found(self, hub_id: str, survivor_id: str, position: dict, score: float):
        """Propagate survivor discovery to all hubs immediately."""
        self.broadcast(
            sender_hub_id=hub_id,
            msg_type=MsgType.SURVIVOR_FOUND,
            payload={
                "survivor_id": survivor_id,
                "position": position,
                "survival_score": round(score, 3),
            },
        )

    # -- Listeners -------------------------------------------------------

    def on_message(self, callback: Callable[[HubMessage], None]):
        """Register a callback for all network messages (e.g. for logging)."""
        self._listeners.append(callback)

    # -- Aggregate Rescue Log --------------------------------------------

    def get_full_rescue_log(self) -> List[dict]:
        """Merge rescue logs from all hubs into one chronological list."""
        all_entries = []
        for hub in self._hubs.values():
            for entry in hub.rescue_log:
                all_entries.append(entry.to_dict())
        all_entries.sort(key=lambda e: e.get("time", 0))
        return all_entries

    # -- Serialization ---------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "hub_count": len(self._hubs),
            "hub_ids": list(self._hubs.keys()),
            "message_count": len(self._message_log),
            "consensus_count": len(self._consensus_table),
            "network_tick": self._tick,
        }
