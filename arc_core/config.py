"""
A.R.C. Global Configuration & Constants

All tunable parameters for the rescue cluster system.
Organized by module for easy adjustment during development and demo.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict


# ============================================================================
# Enumerations
# ============================================================================

class DisasterType(Enum):
    """Supported disaster scenarios."""
    EARTHQUAKE = "earthquake"
    FLOOD = "flood"
    TYPHOON = "typhoon"
    WILDFIRE = "wildfire"
    LANDSLIDE = "landslide"
    TSUNAMI = "tsunami"


class SystemMode(Enum):
    """Connectivity-based operating modes (State Machine states)."""
    EDGE_ONLY = "edge_only"      # No network: Gemma 4 standalone
    CLOUD_EDGE = "cloud_edge"    # Network available: Gemini 3 + Gemma 4


class AgentType(Enum):
    """Heterogeneous unmanned vehicle types."""
    UGV = "ugv"          # Tracked ground vehicle — high payload, power hub
    UAV = "uav"          # Drone — fast recon, low endurance
    BALLOON = "balloon"  # Aerostat platform — long endurance, wide-area monitoring


class HealthStatus(Enum):
    """Agent operational health."""
    NOMINAL = "nominal"
    DEGRADED = "degraded"
    CRITICAL = "critical"
    OFFLINE = "offline"


class AgentTask(Enum):
    """Current task assignment for an agent."""
    IDLE = "idle"
    RECON = "recon"                # Aerial reconnaissance
    TRANSPORT = "transport"        # Cargo / equipment transport
    RELAY = "relay"                # Communication relay
    SEARCH = "search"             # Life signal search
    RESCUE = "rescue"             # Active rescue operation
    CHARGE = "charge"             # Charging / being charged
    DEPLOY_BALLOON = "deploy_balloon"  # Deploying aerostat platform
    SACRIFICED = "sacrificed"      # Abandoned for greater good


# ============================================================================
# Configuration Dataclasses
# ============================================================================

@dataclass
class ConnectivityConfig:
    """State machine parameters for network mode switching."""
    heartbeat_interval_sec: float = 5.0
    max_missed_heartbeats: int = 3      # 3 misses → switch to EDGE_ONLY
    cloud_endpoint: str = "https://api.arc-rescue.local/heartbeat"


@dataclass
class SurvivalWeights:
    """
    Weights for the survival probability scoring model:
      S = w_env * F_env + w_phys * F_phys + w_time * F_time + w_social * F_social
    
    Configurable per disaster type. Defaults tuned for earthquake scenarios.
    """
    w_env: float = 0.25       # Environmental factors
    w_phys: float = 0.25      # Physiological factors
    w_time: float = 0.35      # Time-critical factors (most important)
    w_social: float = 0.15    # Social / group factors

    def validate(self) -> bool:
        total = self.w_env + self.w_phys + self.w_time + self.w_social
        return abs(total - 1.0) < 1e-6


@dataclass
class AgentCapabilities:
    """Default capabilities per agent type."""
    # Battery: 0.0 ~ 1.0 (fraction remaining)
    # Speed: m/s
    # Payload: kg remaining capacity
    # Comm range: meters
    ugv: Dict = field(default_factory=lambda: {
        "max_speed_mps": 5.0,
        "max_payload_kg": 200.0,
        "battery_drain_per_min": 0.002,  # Very long endurance
        "comm_range_m": 500.0,
        "can_charge_others": True,
        "solar_recharge_rate": 0.001,     # Per minute
        "gemma_model": "E4B",
    })
    uav: Dict = field(default_factory=lambda: {
        "max_speed_mps": 20.0,
        "max_payload_kg": 5.0,
        "battery_drain_per_min": 0.02,   # Short endurance
        "comm_range_m": 1000.0,
        "can_charge_others": False,
        "solar_recharge_rate": 0.0,
        "gemma_model": "E2B",
    })
    balloon: Dict = field(default_factory=lambda: {
        "max_speed_mps": 0.5,            # Near-stationary
        "max_payload_kg": 10.0,
        "battery_drain_per_min": 0.0005, # Ultra-long endurance (solar)
        "comm_range_m": 5000.0,
        "can_charge_others": False,
        "solar_recharge_rate": 0.002,
        "gemma_model": "E2B",
    })

    def get(self, agent_type: AgentType) -> Dict:
        return {
            AgentType.UGV: self.ugv,
            AgentType.UAV: self.uav,
            AgentType.BALLOON: self.balloon,
        }[agent_type]


@dataclass
class HubConfig:
    """Decision Hub formation and governance parameters."""
    min_agents_for_hub: int = 3           # Minimum agents to auto-form a hub
    leader_score_weights: Dict = field(default_factory=lambda: {
        "battery": 0.35,
        "compute_power": 0.55,  # UGV (E4B=1.0) >> UAV/Balloon (E2B=0.5): UGV wins
        "comm_capability": 0.10,
    })
    sacrifice_efficiency_threshold: float = 0.30  # Sacrifice if overall efficiency gain > 30%
    hub_comm_interval_sec: float = 10.0            # Inter-hub sync interval


@dataclass
class TriggerConfig:
    """Disaster trigger detection thresholds."""
    seismic_magnitude_threshold: float = 4.0    # Richter scale
    wind_speed_threshold_mps: float = 33.0      # Category 1 hurricane
    rainfall_threshold_mmh: float = 50.0        # Heavy rain
    comm_blackout_timeout_sec: float = 300.0    # 5 min comm loss → auto-trigger


@dataclass
class SimulationConfig:
    """Simulation environment parameters.
    
    Single-depot reference config (covers ~50 km²):
      15 UAV + 8 UGV + 20 Balloon + 2 × 50kW diesel generators
    Full 4-depot city deployment: ×4 of the above.
    """
    tick_duration_sec: float = 1.0       # Simulation time step
    map_width_m: float = 5000.0
    map_height_m: float = 5000.0
    default_ugv_count: int = 8
    default_uav_count: int = 15
    default_balloon_count: int = 20
    default_generator_count: int = 2     # 50 kW diesel generators per depot
    default_fleet_size: int = default_ugv_count + default_uav_count + default_balloon_count  # 43


# ============================================================================
# Master Config Singleton
# ============================================================================

@dataclass
class ARCConfig:
    """Master configuration object aggregating all sub-configs."""
    connectivity: ConnectivityConfig = field(default_factory=ConnectivityConfig)
    survival_weights: SurvivalWeights = field(default_factory=SurvivalWeights)
    agent_capabilities: AgentCapabilities = field(default_factory=AgentCapabilities)
    hub: HubConfig = field(default_factory=HubConfig)
    trigger: TriggerConfig = field(default_factory=TriggerConfig)
    simulation: SimulationConfig = field(default_factory=SimulationConfig)


# Default global config instance
DEFAULT_CONFIG = ARCConfig()
