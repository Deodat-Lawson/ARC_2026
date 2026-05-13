"""
Connectivity State Machine

Manages switching between EDGE_ONLY (Gemma 4 standalone) and CLOUD_EDGE
(Gemini 3 + Gemma 4 cooperative) modes based on network heartbeat status.

State transitions:
    EDGE_ONLY --[network restored]--> CLOUD_EDGE
    CLOUD_EDGE --[heartbeat timeout]--> EDGE_ONLY
"""

import time
import logging
from dataclasses import dataclass, field
from typing import Callable, List, Optional

from arc_core.config import SystemMode, ConnectivityConfig

logger = logging.getLogger(__name__)


@dataclass
class StateTransition:
    """Record of a state transition event."""
    timestamp: float
    from_state: SystemMode
    to_state: SystemMode
    reason: str


class ConnectivityStateMachine:
    """
    Finite State Machine for network connectivity management.
    
    Heartbeat-based detection:
    - Sends a heartbeat ping every `heartbeat_interval_sec` seconds.
    - If `max_missed_heartbeats` consecutive pings fail → switch to EDGE_ONLY.
    - If a ping succeeds while in EDGE_ONLY → switch to CLOUD_EDGE.
    """

    def __init__(self, config: Optional[ConnectivityConfig] = None):
        self._config = config or ConnectivityConfig()
        self._current_state = SystemMode.EDGE_ONLY  # Start disconnected (safe default)
        self._missed_heartbeats = 0
        self._last_heartbeat_time: float = 0.0
        self._transition_history: List[StateTransition] = []
        self._listeners: List[Callable[[SystemMode, SystemMode], None]] = []

    # -- Properties ----------------------------------------------------------

    @property
    def current_state(self) -> SystemMode:
        return self._current_state

    @property
    def is_cloud_available(self) -> bool:
        return self._current_state == SystemMode.CLOUD_EDGE

    @property
    def transition_history(self) -> List[StateTransition]:
        return list(self._transition_history)

    # -- Event Listeners -----------------------------------------------------

    def on_transition(self, callback: Callable[[SystemMode, SystemMode], None]):
        """Register a callback for state transitions: callback(old_state, new_state)."""
        self._listeners.append(callback)

    def _notify_listeners(self, old: SystemMode, new: SystemMode):
        for cb in self._listeners:
            try:
                cb(old, new)
            except Exception as e:
                logger.warning(f"Transition listener error: {e}")

    # -- State Transitions ---------------------------------------------------

    def _transition_to(self, new_state: SystemMode, reason: str):
        if new_state == self._current_state:
            return
        old_state = self._current_state
        self._current_state = new_state
        record = StateTransition(
            timestamp=time.time(),
            from_state=old_state,
            to_state=new_state,
            reason=reason,
        )
        self._transition_history.append(record)
        logger.info(f"State transition: {old_state.value} -> {new_state.value} | {reason}")
        self._notify_listeners(old_state, new_state)

    def report_heartbeat_success(self):
        """Called when a heartbeat ping to the cloud succeeds."""
        self._missed_heartbeats = 0
        self._last_heartbeat_time = time.time()
        if self._current_state == SystemMode.EDGE_ONLY:
            self._transition_to(
                SystemMode.CLOUD_EDGE,
                reason="Network restored — heartbeat success",
            )

    def report_heartbeat_failure(self):
        """Called when a heartbeat ping to the cloud fails."""
        self._missed_heartbeats += 1
        logger.debug(
            f"Heartbeat miss #{self._missed_heartbeats}"
            f"/{self._config.max_missed_heartbeats}"
        )
        if (
            self._missed_heartbeats >= self._config.max_missed_heartbeats
            and self._current_state == SystemMode.CLOUD_EDGE
        ):
            self._transition_to(
                SystemMode.EDGE_ONLY,
                reason=f"Network lost — {self._missed_heartbeats} consecutive heartbeat failures",
            )

    def force_mode(self, mode: SystemMode, reason: str = "Manual override"):
        """Force a specific mode (e.g., for testing or manual trigger)."""
        self._transition_to(mode, reason=reason)

    # -- Serialization -------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "current_state": self._current_state.value,
            "missed_heartbeats": self._missed_heartbeats,
            "transition_count": len(self._transition_history),
            "last_heartbeat_time": self._last_heartbeat_time,
        }
