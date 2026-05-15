"""
Timeline Generator — A.R.C. 预计算引擎

将 scenario_001.json 驱动 arc_core 逐步推演，输出 timeline.json 供前端零延迟回放。

Run from repository root::

    PYTHONPATH=".:ARC_2026-arc-lite-2d-demo" python -m lite_sim.timeline_generator \\
        --steps 200 --output demo_player/timeline.json

Or from ``ARC_2026-arc-lite-2d-demo``::

    PYTHONPATH=".:.." python -m lite_sim.timeline_generator \\
        --steps 200 --output ../demo_player/timeline.json

Gemma 4 API:
    默认使用 Mock 模式（USE_GEMMA_API=False）。
    将环境变量 GEMMA_API_KEY 设置后，令 USE_GEMMA_API=True 可切换为真实推理。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from arc_core.agents.agent_types import Coordinate3D, Survivor
from arc_core.agents.decision_hub import DecisionHub
from arc_core.agents.edge_agent import EdgeAgent
from arc_core.bridge.scenario_adapter import ScenarioAdapter
from arc_core.config import AgentTask, AgentType, HealthStatus
from lite_sim.road_network import RoadNetwork, RouteState

# ---------------------------------------------------------------------------
# Paths (timeline_generator.py → lite_sim → ARC_2026-arc-lite-2d-demo → repo root)
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCENARIO_PATH = _REPO_ROOT / "ARC_2026-arc-lite-2d-demo" / "scenario_001.json"
OUTPUT_PATH   = _REPO_ROOT / "demo_player" / "timeline.json"
ROAD_GRAPH_PATH = Path(__file__).resolve().parent / "data" / "firenze_300m_roads.json"
TOTAL_STEPS   = 200
CELL_SIZE_M   = 10.0
DYNAMIC_OBSTACLE_SEED = 20260514
DYNAMIC_OBSTACLE_INTERVAL = 12
DYNAMIC_OBSTACLE_START = 18
DYNAMIC_OBSTACLE_MAX = 8
DYNAMIC_OBSTACLE_SPAWN_MIN = 1
DYNAMIC_OBSTACLE_SPAWN_MAX = 2
BALLOON_DEPLOY_RADIUS_CELLS = 1.5
BALLOON_MONITOR_RANGE_CELLS = 12.0

# ---------------------------------------------------------------------------
# Gemma 4 API 接口层（Mock / Real 可切换）
# ---------------------------------------------------------------------------
USE_GEMMA_API: bool = bool(os.getenv("GEMMA_API_KEY"))

def _gemma_reasoning(prompt: str, mock_text: str) -> str:
    """
    统一推理接口。
    - Mock 模式：直接返回 mock_text（纯规则生成的中文推理）
    - Real 模式：调用 Google AI Studio Gemma 4 API

    切换方式:
        export GEMMA_API_KEY="your_key_here"
        然后重新运行 timeline_generator.py
    """
    if not USE_GEMMA_API:
        return mock_text

    try:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=os.environ["GEMMA_API_KEY"])
        model = genai.GenerativeModel("gemma-3-27b-it")
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as exc:
        print(f"[WARN] Gemma API failed ({exc}), falling back to mock.")
        return mock_text


def _gemma_task_allocation(
    agents_info: List[dict],
    victims_info: List[dict],
    mock_assignments: Dict[str, str],
) -> Dict[str, str]:
    """
    Function-Calling 接口：任务分配。
    Mock 模式直接返回规则分配结果；Real 模式调用 Gemma 4 function calling。
    """
    if not USE_GEMMA_API:
        return mock_assignments

    try:
        import google.generativeai as genai  # type: ignore
        from google.generativeai.types import FunctionDeclaration, Tool  # type: ignore

        assign_fn = FunctionDeclaration(
            name="assign_task",
            description="为无人器分配救援任务",
            parameters={
                "type": "object",
                "properties": {
                    "agent_id":        {"type": "string", "description": "无人器ID"},
                    "target_victim_id":{"type": "string", "description": "目标幸存者ID，无则填null"},
                    "task_type": {
                        "type": "string",
                        "enum": ["search", "rescue", "relay", "clear", "recon", "idle"],
                    },
                },
                "required": ["agent_id", "task_type"],
            },
        )
        tool = Tool(function_declarations=[assign_fn])
        genai.configure(api_key=os.environ["GEMMA_API_KEY"])
        model = genai.GenerativeModel("gemma-3-27b-it", tools=[tool])

        prompt = (
            "你是自主救援集群决策中枢。根据以下无人器状态和幸存者信息，"
            "为每台无人器分配最优任务。请对每台无人器调用一次 assign_task。\n"
            f"无人器: {json.dumps(agents_info, ensure_ascii=False)}\n"
            f"幸存者: {json.dumps(victims_info, ensure_ascii=False)}"
        )
        response = model.generate_content(prompt)
        assignments: Dict[str, str] = {}
        for part in response.candidates[0].content.parts:
            if hasattr(part, "function_call"):
                fc = part.function_call
                assignments[fc.args["agent_id"]] = (
                    f"{fc.args['task_type']}_survivor_{fc.args.get('target_victim_id','')}"
                )
        return assignments or mock_assignments
    except Exception as exc:
        print(f"[WARN] Gemma function calling failed ({exc}), falling back to mock.")
        return mock_assignments


# ---------------------------------------------------------------------------
# 地图辅助
# ---------------------------------------------------------------------------

def _grid_dist(ax: float, ay: float, bx: float, by: float) -> float:
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def _step_toward(
    cur: Coordinate3D,
    tx: float,
    ty: float,
    speed_cells: float,
) -> Coordinate3D:
    """Move cur toward (tx, ty) by up to speed_cells grid cells."""
    dx, dy = tx - cur.x / CELL_SIZE_M, ty - cur.y / CELL_SIZE_M
    dist = math.sqrt(dx * dx + dy * dy)
    if dist <= speed_cells:
        return Coordinate3D(tx * CELL_SIZE_M, ty * CELL_SIZE_M, cur.z)
    ratio = speed_cells / dist
    return Coordinate3D(
        (cur.x / CELL_SIZE_M + dx * ratio) * CELL_SIZE_M,
        (cur.y / CELL_SIZE_M + dy * ratio) * CELL_SIZE_M,
        cur.z,
    )


def _calc_comm_coverage(
    agents: List[EdgeAgent],
    map_size: List[int],
    balloon_states: Optional[Dict[str, dict]] = None,
) -> float:
    """Estimate % of map cells covered by any agent's communication range."""
    cols, rows = map_size
    covered = 0
    for row in range(rows):
        for col in range(cols):
            cx, cy = col * CELL_SIZE_M, row * CELL_SIZE_M
            for agent in agents:
                balloon_state = (balloon_states or {}).get(agent.agent_id, {})
                balloon_inactive = (
                    agent.agent_type == AgentType.BALLOON
                    and balloon_state.get("status") != "deployed"
                )
                if (not balloon_inactive
                        and agent.health_status != HealthStatus.OFFLINE
                        and agent.position.distance_2d(Coordinate3D(cx, cy)) <= agent.comm_range_m):
                    covered += 1
                    break
    return round(covered / (cols * rows) * 100, 1)


def _survival_pct(hp: int, hp_max: int) -> float:
    return round(max(0.0, hp / max(hp_max, 1) * 100), 1)


def _make_dynamic_obstacle_schedule(
    map_size: List[int],
    blocked_cells: List[dict],
    steps: int,
) -> Dict[int, List[dict]]:
    """
    Schedule stochastic secondary blockades that appear mid-mission.

    These model aftershocks, debris slides, vehicle pile-ups, or fire-spread
    closures. They are deterministic for reproducibility, but still random
    with respect to position and timing.
    """
    rng = random.Random(DYNAMIC_OBSTACLE_SEED)
    cols, rows = map_size
    occupied = {
        tuple(b.get("location", [-1, -1]))
        for b in blocked_cells
    }
    schedule: Dict[int, List[dict]] = {}
    if steps <= DYNAMIC_OBSTACLE_START:
        return schedule

    candidate_steps = list(range(
        DYNAMIC_OBSTACLE_START,
        steps,
        DYNAMIC_OBSTACLE_INTERVAL,
    ))
    spawn_steps = candidate_steps[:DYNAMIC_OBSTACLE_MAX]

    idx = 1
    for spawn_step in spawn_steps:
        for _ in range(rng.randint(DYNAMIC_OBSTACLE_SPAWN_MIN, DYNAMIC_OBSTACLE_SPAWN_MAX)):
            loc = None
            for _attempt in range(300):
                c = rng.randint(2, max(2, cols - 3))
                r = rng.randint(2, max(2, rows - 3))
                if (c, r) in occupied:
                    continue
                # Keep the initial base area open enough for launch.
                if c < 6 and r < 6:
                    continue
                loc = [c, r]
                occupied.add((c, r))
                break
            if loc is None:
                continue

            obstacle = {
                "id": f"DYN{idx:02d}",
                "location": loc,
                "repair_cost": None,
                "clear_progress": 0,
                "clear_rate": 0,
                "status": "blocked",
                "clearable": False,
                "dynamic": True,
                "spawn_step": spawn_step,
                "reason": rng.choice([
                    "aftershock",
                    "debris_slide",
                    "vehicle_pileup",
                    "fire_spread",
                    "road_collapse",
                    "gas_leak",
                ]),
            }
            schedule.setdefault(spawn_step, []).append(obstacle)
            idx += 1

    return schedule


def _generate_briefing(
    step: int,
    agents: List[EdgeAgent],
    victims_raw: Dict[str, dict],
    rescued: int,
    sacrificed: int,
    balloon_states: Optional[Dict[str, dict]] = None,
) -> str:
    alive = [
        a for a in agents
        if a.health_status != HealthStatus.OFFLINE
        and not (
            a.agent_type == AgentType.BALLOON
            and (balloon_states or {}).get(a.agent_id, {}).get("status") != "deployed"
        )
    ]
    active_victims = [v for v in victims_raw.values() if v.get("status") not in ("rescued", "dead")]
    return (
        f"[Step {step}] 活跃无人器 {len(alive)} 台，"
        f"待救幸存者 {len(active_victims)} 人，"
        f"已救援 {rescued} 人，已牺牲 {sacrificed} 台无人器。"
    )


def _grid_xy(agent: EdgeAgent) -> Tuple[float, float]:
    return (agent.position.x / CELL_SIZE_M, agent.position.y / CELL_SIZE_M)


def _choose_balloon_deploy_target(map_data: dict, map_size: List[int]) -> List[float]:
    dead_zones = map_data.get("communication_dead_zones", [])
    if dead_zones:
        return [float(v) for v in dead_zones[0].get("center", [map_size[0] / 2, map_size[1] / 2])]
    risk_zones = map_data.get("risk_zones", [])
    if risk_zones:
        return [float(v) for v in risk_zones[0].get("center", [map_size[0] / 2, map_size[1] / 2])]
    return [map_size[0] / 2, map_size[1] / 2]


def _init_balloon_states(
    raw_agents: List[dict],
    agents: List[EdgeAgent],
    map_data: dict,
    map_size: List[int],
) -> Dict[str, dict]:
    """Initial balloon state: carried by UGV/UAV until deployed at a priority area."""
    balloons = [a for a in agents if a.agent_type == AgentType.BALLOON]
    carriers = (
        [a for a in agents if a.agent_type == AgentType.UGV]
        + [a for a in agents if a.agent_type == AgentType.UAV]
    )
    deploy_target = _choose_balloon_deploy_target(map_data, map_size)
    states: Dict[str, dict] = {}

    for idx, balloon in enumerate(balloons):
        carrier = carriers[idx % len(carriers)] if carriers else None
        raw = next((a for a in raw_agents if a.get("id") == balloon.agent_id), {})
        status = raw.get("deployment_status", "carried" if carrier else "stored")
        if status == "not_deployed":
            status = "carried" if carrier else "stored"

        states[balloon.agent_id] = {
            "status": status,
            "carrier_id": carrier.agent_id if carrier else None,
            "deployment_target": deploy_target,
            "deployed_step": None,
            "comm_restored": False,
        }
        if carrier:
            balloon.position = Coordinate3D(carrier.position.x, carrier.position.y, 20.0)
        balloon.current_task = AgentTask.DEPLOY_BALLOON if status != "deployed" else AgentTask.RELAY
    return states


def _find_agent(agents: List[EdgeAgent], agent_id: Optional[str]) -> Optional[EdgeAgent]:
    if not agent_id:
        return None
    return next((a for a in agents if a.agent_id == agent_id), None)


def _sync_carried_balloons(agents: List[EdgeAgent], balloon_states: Dict[str, dict]) -> None:
    for balloon_id, state in balloon_states.items():
        if state.get("status") == "deployed":
            continue
        balloon = _find_agent(agents, balloon_id)
        carrier = _find_agent(agents, state.get("carrier_id"))
        if balloon and carrier:
            balloon.position = Coordinate3D(carrier.position.x, carrier.position.y, 20.0)


def _update_balloon_deployments(
    agents: List[EdgeAgent],
    balloon_states: Dict[str, dict],
    step: int,
) -> List[dict]:
    events: List[dict] = []
    for balloon_id, state in balloon_states.items():
        balloon = _find_agent(agents, balloon_id)
        carrier = _find_agent(agents, state.get("carrier_id"))
        if balloon is None:
            continue

        if state.get("status") != "deployed" and carrier is not None:
            tx, ty = state["deployment_target"]
            cx, cy = _grid_xy(carrier)
            if _grid_dist(cx, cy, tx, ty) <= BALLOON_DEPLOY_RADIUS_CELLS:
                state["status"] = "deployed"
                state["deployed_step"] = step
                carrier.current_task = AgentTask.RESCUE
                balloon.current_task = AgentTask.RELAY
                balloon.position = Coordinate3D(tx * CELL_SIZE_M, ty * CELL_SIZE_M, 200.0)
                events.append({
                    "type": "balloon_deployed",
                    "description": (
                        f"🎈 {balloon_id} deployed by {carrier.agent_id} "
                        f"at priority relay zone {state['deployment_target']}"
                    ),
                    "agents_involved": [carrier.agent_id, balloon_id],
                })
            else:
                balloon.position = Coordinate3D(carrier.position.x, carrier.position.y, 20.0)

        if (
            state.get("status") == "deployed"
            and state.get("deployed_step") is not None
            and not state.get("comm_restored")
            and step >= int(state["deployed_step"]) + 3
        ):
            state["comm_restored"] = True
            events.append({
                "type": "comm_restored",
                "description": f"📡 External comm restored via {balloon_id} relay",
                "agents_involved": [balloon_id],
            })
    return events


def _balloon_monitor_targets(
    agents: List[EdgeAgent],
    balloon_states: Dict[str, dict],
    victims_raw: Dict[str, dict],
) -> List[str]:
    discovered: List[str] = []
    for balloon_id, state in balloon_states.items():
        if state.get("status") != "deployed":
            continue
        balloon = _find_agent(agents, balloon_id)
        if balloon is None:
            continue
        bx, by = _grid_xy(balloon)
        for vid, victim in victims_raw.items():
            if victim.get("status") in ("rescued", "dead"):
                continue
            vx, vy = victim["location"]
            if _grid_dist(bx, by, vx, vy) <= BALLOON_MONITOR_RANGE_CELLS:
                victim.setdefault("discovered_by", balloon_id)
                discovered.append(vid)
    return discovered


def _blocked_points(blocked_cells: List[dict]) -> List[Tuple[float, float]]:
    return [
        (float(b["location"][0]), float(b["location"][1]))
        for b in blocked_cells
        if b.get("status") == "blocked"
    ]


def _obstacle_signature(blocked_cells: List[dict]) -> str:
    active = [
        f"{b.get('id')}@{b.get('location')}"
        for b in blocked_cells
        if b.get("status") == "blocked"
    ]
    return "|".join(active)


# ---------------------------------------------------------------------------
# 移动逻辑
# ---------------------------------------------------------------------------

def _assign_agent_targets(
    agents: List[EdgeAgent],
    victims_raw: Dict[str, dict],
    blocked_cells: List[dict],
    step: int,
    map_size: List[int],
    balloon_states: Optional[Dict[str, dict]] = None,
) -> Dict[str, Optional[str]]:
    """Return {agent_id: target_victim_id_or_None}."""
    targets: Dict[str, Optional[str]] = {}
    active = [
        v for v in victims_raw.values()
        if v.get("status") not in ("rescued", "dead")
    ]
    # Sort by urgency: highest damage_per_step first
    active.sort(key=lambda v: -v.get("damage_per_step", 0))

    uav_idx = 0
    ugv_idx = 0
    for agent in agents:
        if agent.health_status == HealthStatus.OFFLINE:
            targets[agent.agent_id] = None
            continue
        if agent.agent_type == AgentType.BALLOON:
            targets[agent.agent_id] = None
        elif agent.agent_type == AgentType.UAV:
            if uav_idx < len(active):
                targets[agent.agent_id] = active[uav_idx]["id"]
                uav_idx += 1
            else:
                targets[agent.agent_id] = None
        else:  # UGV
            carried_balloon = next((
                balloon_id for balloon_id, state in (balloon_states or {}).items()
                if state.get("carrier_id") == agent.agent_id
                and state.get("status") != "deployed"
            ), None)
            if carried_balloon:
                targets[agent.agent_id] = f"__deploy_balloon_{carried_balloon}"
                continue
            if ugv_idx < len(active):
                targets[agent.agent_id] = active[min(ugv_idx, len(active) - 1)]["id"]
                ugv_idx += 1
            else:
                targets[agent.agent_id] = None
    return targets


def _move_agents(
    agents: List[EdgeAgent],
    victims_raw: Dict[str, dict],
    targets: Dict[str, Optional[str]],
    blocked_cells: List[dict],
    map_size: List[int],
    step: int,
    road_network: Optional[RoadNetwork] = None,
    road_route_cache: Optional[Dict[str, RouteState]] = None,
    balloon_states: Optional[Dict[str, dict]] = None,
):
    map_center = (map_size[0] / 2, map_size[1] / 2)
    obstacle_signature = _obstacle_signature(blocked_cells)

    for agent in agents:
        if agent.health_status == HealthStatus.OFFLINE:
            continue

        speed = agent.max_speed_mps / CELL_SIZE_M  # cells per step

        if agent.agent_type == AgentType.BALLOON:
            state = (balloon_states or {}).get(agent.agent_id, {})
            if state.get("status") != "deployed":
                carrier = _find_agent(agents, state.get("carrier_id"))
                if carrier:
                    agent.position = Coordinate3D(carrier.position.x, carrier.position.y, 20.0)
            else:
                tx, ty = state.get("deployment_target", map_center)
                agent.position = Coordinate3D(tx * CELL_SIZE_M, ty * CELL_SIZE_M, 200.0)
            continue

        target_id = targets.get(agent.agent_id)
        if target_id is None:
            if road_route_cache is not None:
                road_route_cache.pop(agent.agent_id, None)
            continue

        if target_id.startswith("__deploy_balloon_"):
            balloon_id = target_id[len("__deploy_balloon_"):]
            state = (balloon_states or {}).get(balloon_id)
            if state:
                tx, ty = state["deployment_target"]
                agent.current_task = AgentTask.DEPLOY_BALLOON
                agent.position = _step_agent(
                    agent, tx, ty, speed, f"{target_id}|{obstacle_signature}",
                    road_network, road_route_cache, blocked_cells
                )
            continue

        # Move toward victim
        victim = victims_raw.get(target_id)
        if victim is None or victim.get("status") in ("rescued", "dead"):
            if road_route_cache is not None:
                road_route_cache.pop(agent.agent_id, None)
            continue
        tx, ty = victim["location"]
        agent.position = _step_agent(
            agent, tx, ty, speed, f"{target_id}|{obstacle_signature}",
            road_network, road_route_cache, blocked_cells
        )


def _step_agent(
    agent: EdgeAgent,
    tx: float,
    ty: float,
    speed_cells: float,
    target_key: str,
    road_network: Optional[RoadNetwork],
    road_route_cache: Optional[Dict[str, RouteState]],
    blocked_cells: Optional[List[dict]] = None,
) -> Coordinate3D:
    if agent.agent_type != AgentType.UGV or road_network is None or not road_network.available:
        return _step_toward(agent.position, tx, ty, speed_cells)

    cur_grid = (agent.position.x / CELL_SIZE_M, agent.position.y / CELL_SIZE_M)
    next_grid, route_state = road_network.route_step(
        cur_grid,
        (tx, ty),
        speed_cells,
        target_key,
        road_route_cache.get(agent.agent_id) if road_route_cache is not None else None,
        blocked_points=_blocked_points(blocked_cells or []),
    )
    if road_route_cache is not None:
        road_route_cache[agent.agent_id] = route_state
    return Coordinate3D(next_grid[0] * CELL_SIZE_M, next_grid[1] * CELL_SIZE_M, agent.position.z)


# ---------------------------------------------------------------------------
# Main simulation loop
# ---------------------------------------------------------------------------

def run(
    scenario_path: Path = SCENARIO_PATH,
    steps: int = TOTAL_STEPS,
    output: Path = OUTPUT_PATH,
):
    print(f"[timeline_generator] Loading scenario: {scenario_path}")
    raw = json.loads(Path(scenario_path).read_text(encoding="utf-8"))

    adapter = ScenarioAdapter(cell_size_m=CELL_SIZE_M)
    scenario = adapter.json_to_scenario(raw)
    agents   = adapter.json_to_agents(raw)

    map_data      = raw.get("map", {})
    map_size      = map_data.get("size", [30, 30])
    blocked_cells = map_data.get("blocked_cells", [])
    risk_zones    = map_data.get("risk_zones", [])
    dead_zones    = map_data.get("communication_dead_zones", [])
    dynamic_obstacles = _make_dynamic_obstacle_schedule(map_size, blocked_cells, steps)
    road_network = RoadNetwork.from_file(ROAD_GRAPH_PATH) if ROAD_GRAPH_PATH.exists() else None
    road_route_cache: Dict[str, RouteState] = {}
    if road_network and road_network.available:
        print(
            f"[timeline_generator] Road network loaded: "
            f"{len(road_network.graph)} nodes, {len(road_network.segments)} segments"
        )
    else:
        print("[timeline_generator] Road network unavailable; UGVs use direct grid movement.")
    balloon_states = _init_balloon_states(
        raw.get("agents", []), agents, map_data, map_size
    )

    # Mutable victim state (keep hp / damage_per_step from raw JSON)
    victims_raw: Dict[str, dict] = {
        v["id"]: {**v} for v in raw.get("victims", [])
    }

    hubs: List[DecisionHub] = []
    formed_hub_ids: set = set()
    frames: List[dict] = []
    rescued_count   = 0
    sacrificed_count = 0

    print(f"[timeline_generator] Running {steps} steps (Gemma API: {'ON' if USE_GEMMA_API else 'Mock'})...")

    for step in range(steps):
        hub_events: List[dict] = []

        # ── 0. Dynamic obstacle emergence ─────────────────────────────────
        for obstacle in dynamic_obstacles.get(step, []):
            blocked_cells.append(obstacle)
            hub_events.append({
                "type": "dynamic_obstacle",
                "description": (
                    f"⚠️ 新障碍 {obstacle['id']} 出现 "
                    f"({obstacle['reason']})，位置 {obstacle['location']}"
                ),
                "agents_involved": [],
            })

        # ── 1. Hub formation ────────────────────────────────────────────────
        for agent in agents:
            agent.discover_peers(agents)

        eligible = [
            a for a in agents
            if not a.is_in_hub
            and a.health_status != HealthStatus.OFFLINE
            and a.should_form_group()
        ]
        if eligible and len(eligible) >= 3:
            # Take first 3 eligible agents and form a hub
            candidates = eligible[:3]
            hub_key = frozenset(a.agent_id for a in candidates)
            if hub_key not in formed_hub_ids:
                new_hub = DecisionHub(candidates)
                hubs.append(new_hub)
                formed_hub_ids.add(hub_key)
                hub_events.append({
                    "type": "hub_formed",
                    "description": (
                        f"🔗 Hub Formed: {len(candidates)} agents elected "
                        f"{new_hub._leader_id} as Leader"
                    ),
                    "agents_involved": [a.agent_id for a in candidates],
                })

        # ── 2. Hub decisions ─────────────────────────────────────────────────
        thinking_log = ""
        for hub in hubs:
            hub.begin_step()

            active_victims_obj = [
                s for s in scenario.survivors
                if victims_raw.get(s.survivor_id, {}).get("status")
                   not in ("rescued", "dead")
            ]

            # Build mock assignment for possible API override
            mock_assignments = {}
            uavs_free = [a for a in hub.members if a.agent_type == AgentType.UAV]
            ugvs_free = [a for a in hub.members if a.agent_type == AgentType.UGV]
            active_sorted = sorted(
                active_victims_obj,
                key=lambda v: -v.injury_severity
            )
            for i, sv in enumerate(active_sorted):
                if i < len(uavs_free):
                    mock_assignments[uavs_free[i].agent_id] = f"search_survivor_{sv.survivor_id}"
                if i < len(ugvs_free):
                    mock_assignments[ugvs_free[i].agent_id] = f"rescue_survivor_{sv.survivor_id}"

            # Optionally upgrade to Gemma 4 function calling
            _gemma_task_allocation(
                agents_info=[a.to_dict() for a in hub.members],
                victims_info=[victims_raw[sv.survivor_id] for sv in active_victims_obj
                              if sv.survivor_id in victims_raw],
                mock_assignments=mock_assignments,
            )

            hub.allocate_tasks(active_victims_obj)

            transfers = hub.allocate_energy()
            for t in transfers:
                from_pct = int((t["from_battery"] if "from_battery" in t
                                else 0) * 100) if False else ""
                hub_events.append({
                    "type": "energy_transfer",
                    "description": (
                        f"⚡ {t['from']} charging {t['to']} "
                        f"(+{int(t['amount']*100)}%)"
                    ),
                    "agents_involved": [t["from"], t["to"]],
                })

            sacrificed_id = hub.evaluate_sacrifice()
            if sacrificed_id:
                sacrificed_count += 1
                hub_events.append({
                    "type": "sacrifice",
                    "description": f"💀 {sacrificed_id} sacrificed for fleet efficiency",
                    "agents_involved": [sacrificed_id],
                })

            # Optionally augment thinking_log with Gemma 4 real reasoning
            rule_thinking = hub.get_thinking_log_for_step()
            if active_victims_obj:
                top = max(active_victims_obj, key=lambda v: v.injury_severity)
                urgency_info = (
                    f"当前最紧急: {top.survivor_id}，"
                    f"伤势{int(top.injury_severity*100)}%，"
                    f"HP剩余{victims_raw.get(top.survivor_id,{}).get('hp','?')}"
                )
            else:
                urgency_info = "所有已知幸存者已处理"

            mock_thinking = rule_thinking or urgency_info
            gemma_prompt = (
                f"你是搭载Gemma4的自主救援无人器决策枢纽，当前第{step}步。\n"
                f"状态: {urgency_info}\n"
                f"用一句50字以内的中文描述本步决策推理过程。"
            )
            thinking_log = _gemma_reasoning(gemma_prompt, mock_thinking)

        # ── 3. Agent movement ─────────────────────────────────────────────
        targets = _assign_agent_targets(
            agents, victims_raw, blocked_cells, step, map_size, balloon_states=balloon_states
        )
        _move_agents(
            agents,
            victims_raw,
            targets,
            blocked_cells,
            map_size,
            step,
            road_network=road_network,
            road_route_cache=road_route_cache,
            balloon_states=balloon_states,
        )
        _sync_carried_balloons(agents, balloon_states)
        hub_events.extend(_update_balloon_deployments(agents, balloon_states, step))
        monitored_targets = _balloon_monitor_targets(agents, balloon_states, victims_raw)
        if monitored_targets and step % 10 == 0:
            hub_events.append({
                "type": "comm_restored",
                "description": (
                    f"📡 Balloon relay monitoring targets: "
                    f"{', '.join(sorted(set(monitored_targets))[:4])}"
                ),
                "agents_involved": [
                    bid for bid, state in balloon_states.items()
                    if state.get("status") == "deployed"
                ],
            })

        # ── 4. Battery drain ──────────────────────────────────────────────
        for agent in agents:
            if agent.health_status != HealthStatus.OFFLINE:
                agent._drain_battery()

        # ── 5. Blockades are permanent; UGVs must route around them ───────

        # ── 6. Rescue check ───────────────────────────────────────────────
        for vid, victim in victims_raw.items():
            if victim.get("status") in ("rescued", "dead"):
                continue

            # HP decay
            victim["hp"] = victim.get("hp", 10000) - victim.get("damage_per_step", 0)
            if victim["hp"] <= 0:
                victim["hp"] = 0
                victim["status"] = "dead"
                hub_events.append({
                    "type": "victim_dead",
                    "description": f"💔 {vid} 未能在黄金窗口内获救",
                    "agents_involved": [],
                })
                continue

            vx, vy = victim["location"]
            for agent in agents:
                if (agent.agent_type == AgentType.UGV
                        and agent.health_status != HealthStatus.OFFLINE
                        and _grid_dist(
                            agent.position.x / CELL_SIZE_M,
                            agent.position.y / CELL_SIZE_M,
                            vx, vy
                        ) < 1.5):
                    victim["status"] = "rescued"
                    rescued_count += 1
                    hub_events.append({
                        "type": "rescued",
                        "description": f"✅ {vid} RESCUED by {agent.agent_id}!",
                        "agents_involved": [agent.agent_id],
                    })
                    # Also sync to scenario survivors
                    for s in scenario.survivors:
                        if s.survivor_id == vid:
                            s.status = "rescued"
                    break

        # ── 7. Victim survival % alert ─────────────────────────────────────
        for vid, victim in victims_raw.items():
            if victim.get("status") not in ("rescued", "dead"):
                hp_max = next(
                    (v.get("hp", 10000) for v in raw.get("victims", []) if v["id"] == vid),
                    10000,
                )
                pct = _survival_pct(victim["hp"], hp_max)
                if pct < 40 and victim.get("_alerted_40") is None:
                    victim["_alerted_40"] = True
                    hub_events.append({
                        "type": "alert",
                        "description": f"🚨 {vid} survival drops below 40%!",
                        "agents_involved": [],
                    })

        # ── 8. Balloon relay/monitoring state is event-driven ─────────────

        # ── 9. Serialize frame ────────────────────────────────────────────
        hp_max_map = {
            v["id"]: v.get("hp", 10000) for v in raw.get("victims", [])
        }
        # Patch: store initial hp as hp_max (first frame reference)
        frame_victims = []
        for vid, victim in victims_raw.items():
            hp_now = victim.get("hp", 0)
            hp_max = hp_max_map.get(vid, 10000)
            frame_victims.append({
                "id": vid,
                "location": victim["location"],
                "hp": hp_now,
                "hp_max": hp_max,
                "survival_pct": _survival_pct(hp_now, hp_max),
                "status": victim.get("status", "trapped"),
                "thermal_signal": victim.get("thermal_signal", 0),
            })

        frame_agents = []
        for agent in agents:
            balloon_state = balloon_states.get(agent.agent_id, {})
            frame_agents.append({
                **agent.to_dict(),
                "location": [
                    round(agent.position.x / CELL_SIZE_M, 2),
                    round(agent.position.y / CELL_SIZE_M, 2),
                ],
                "target": targets.get(agent.agent_id),
                "deployment_status": balloon_state.get("status"),
                "carrier_id": balloon_state.get("carrier_id"),
                "deployment_target": balloon_state.get("deployment_target"),
                "thinking": "",
            })

        frames.append({
            "step": step,
            "agents": frame_agents,
            "victims": frame_victims,
            "hubs": [h.to_dict() for h in hubs],
            "blocked_cells": [
                {k: v for k, v in b.items() if k != "_alerted_40"}
                for b in blocked_cells
            ],
            "events": hub_events,
            "briefing": _generate_briefing(
                step, agents, victims_raw, rescued_count, sacrificed_count, balloon_states
            ),
            "thinking_log": thinking_log,
            "stats": {
                "rescued": rescued_count,
                "sacrificed": sacrificed_count,
                "active_agents": sum(
                    1 for a in agents
                    if a.health_status != HealthStatus.OFFLINE
                    and not (
                        a.agent_type == AgentType.BALLOON
                        and balloon_states.get(a.agent_id, {}).get("status") != "deployed"
                    )
                ),
                "comm_coverage_pct": _calc_comm_coverage(agents, map_size, balloon_states),
            },
        })

        # ── 10. Early termination ─────────────────────────────────────────
        if all(
            victims_raw[v["id"]].get("status") in ("rescued", "dead")
            for v in raw.get("victims", [])
        ):
            print(f"[timeline_generator] All victims resolved at step {step}.")
            break

    # ── Output ────────────────────────────────────────────────────────────
    output_data = {
        "scenario_id": raw.get("scenario_id", "urban_quake_001"),
        "map": {
            "size": map_size,
            "cell_size_m": map_data.get("cell_size_m", CELL_SIZE_M),
            "base": map_data.get("base", [2, 2]),
            "risk_zones": risk_zones,
            "communication_dead_zones": dead_zones,
        },
        "total_steps": len(frames),
        "frames": frames,
    }
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(
        json.dumps(output_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(
        f"[timeline_generator] Done: {len(frames)} frames → {output}\n"
        f"  Rescued: {rescued_count} | Sacrificed: {sacrificed_count}"
    )
    return output_data


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="A.R.C. Timeline Generator")
    parser.add_argument(
        "--scenario", type=Path, default=SCENARIO_PATH,
        help="Path to scenario JSON (default: scenario_001.json)",
    )
    parser.add_argument(
        "--steps", type=int, default=TOTAL_STEPS,
        help="Number of simulation steps (default: 200)",
    )
    parser.add_argument(
        "--output", type=Path, default=OUTPUT_PATH,
        help="Output path for timeline.json",
    )
    args = parser.parse_args()
    run(scenario_path=args.scenario, steps=args.steps, output=args.output)
