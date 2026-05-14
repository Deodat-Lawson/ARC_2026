"""
Timeline Generator — A.R.C. 预计算引擎

将 scenario_001.json 驱动 arc_core 逐步推演，输出 timeline.json 供前端零延迟回放。

用法:
    python -m arc_core.simulation.timeline_generator
    python -m arc_core.simulation.timeline_generator --steps 200 --output demo_player/timeline.json

Gemma 4 API 接口:
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
from arc_core.paths import (
    DEFAULT_SCENARIO_PATH,
    DEFAULT_TIMELINE_PATH,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCENARIO_PATH = DEFAULT_SCENARIO_PATH
OUTPUT_PATH = DEFAULT_TIMELINE_PATH
TOTAL_STEPS   = 200
CELL_SIZE_M   = 10.0

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
# 气球投放计划 — carrier 到达 deploy_target 附近时气球脱离，独立漂移定位
# UGV-5 / UGV-6 负责地面投放；UAV-11/12/13 负责空投
# ---------------------------------------------------------------------------

# Ordered deployment sequences per carrier (carrier deploys balloons in order as it
# moves along its route; each entry is {bal_id, target})
_UGV5_ROUTE  = [
    ("BAL-1",  [5,  5]),  ("BAL-6",  [5, 10]),
    ("BAL-11", [5, 15]),  ("BAL-16", [5, 20]),
]
_UGV6_ROUTE  = [
    ("BAL-2",  [10,  5]), ("BAL-7",  [10, 10]),
    ("BAL-12", [10, 15]), ("BAL-17", [10, 20]),
]
_UAV11_ROUTE = [
    ("BAL-3",  [15,  5]), ("BAL-8",  [15, 10]),
    ("BAL-13", [15, 15]), ("BAL-18", [15, 20]),
]
_UAV12_ROUTE = [
    ("BAL-4",  [20,  5]), ("BAL-9",  [20, 10]),
    ("BAL-14", [20, 15]), ("BAL-19", [20, 20]),
]
_UAV13_ROUTE = [
    ("BAL-5",  [25,  5]), ("BAL-10", [25, 10]),
    ("BAL-15", [25, 15]), ("BAL-20", [25, 20]),
]

# Lookup: carrier_id → ordered route list
CARRIER_ROUTES: Dict[str, list] = {
    "UGV-5":  _UGV5_ROUTE,
    "UGV-6":  _UGV6_ROUTE,
    "UAV-11": _UAV11_ROUTE,
    "UAV-12": _UAV12_ROUTE,
    "UAV-13": _UAV13_ROUTE,
}

# balloon_id → carrier_id (read from scenario JSON)
BALLOON_CARRIER: Dict[str, str] = {}

# balloon_deploy_state tracks which index in its carrier's route is next to deploy
# {carrier_id: int}  — index into CARRIER_ROUTES[carrier_id]
_carrier_deploy_idx: Dict[str, int] = {}

# balloon deploy status: {balloon_id: True = deployed}
_balloon_deployed: Dict[str, bool] = {}


def _init_balloon_state(raw: dict):
    """Populate BALLOON_CARRIER and reset deploy indexes from scenario data."""
    BALLOON_CARRIER.clear()
    _carrier_deploy_idx.clear()
    _balloon_deployed.clear()
    for a in raw.get("agents", []):
        if a.get("type") == "balloon" and "carrier_id" in a:
            BALLOON_CARRIER[a["id"]] = a["carrier_id"]
    for carrier_id in CARRIER_ROUTES:
        _carrier_deploy_idx[carrier_id] = 0
    for bal_id in BALLOON_CARRIER:
        _balloon_deployed[bal_id] = False


def _get_carrier_current_target(carrier_id: str) -> Optional[list]:
    """Return the next deploy-target for this carrier (None if all deployed)."""
    route = CARRIER_ROUTES.get(carrier_id, [])
    idx = _carrier_deploy_idx.get(carrier_id, 0)
    while idx < len(route):
        bal_id, target = route[idx]
        if not _balloon_deployed.get(bal_id, True):
            return target
        idx += 1
    return None  # all balloons for this carrier are deployed


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


def _calc_comm_coverage(agents: List[EdgeAgent], map_size: List[int]) -> float:
    """Estimate % of map cells covered by any agent's communication range."""
    cols, rows = map_size
    covered = 0
    for row in range(rows):
        for col in range(cols):
            cx, cy = col * CELL_SIZE_M, row * CELL_SIZE_M
            for agent in agents:
                if (agent.health_status != HealthStatus.OFFLINE
                        and agent.position.distance_2d(Coordinate3D(cx, cy)) <= agent.comm_range_m):
                    covered += 1
                    break
    return round(covered / (cols * rows) * 100, 1)


def _survival_pct(hp: int, hp_max: int) -> float:
    return round(max(0.0, hp / max(hp_max, 1) * 100), 1)


def _generate_briefing(
    step: int,
    agents: List[EdgeAgent],
    victims_raw: Dict[str, dict],
    rescued: int,
    sacrificed: int,
) -> str:
    alive = [a for a in agents if a.health_status != HealthStatus.OFFLINE]
    active_victims = [v for v in victims_raw.values() if v.get("status") not in ("rescued", "dead")]
    return (
        f"[Step {step}] 活跃无人器 {len(alive)} 台，"
        f"待救幸存者 {len(active_victims)} 人，"
        f"已救援 {rescued} 人，已牺牲 {sacrificed} 台无人器。"
    )


# ---------------------------------------------------------------------------
# 移动逻辑
# ---------------------------------------------------------------------------

def _assign_agent_targets(
    agents: List[EdgeAgent],
    victims_raw: Dict[str, dict],
    blocked_cells: List[dict],
    step: int,
    map_size: List[int],
) -> Dict[str, Optional[str]]:
    """Return {agent_id: target_victim_id_or_None}.

    Special prefixes used internally (not real victim IDs):
      __block_<id>   — clearing a blockade
      __deploy_<x>_<y>  — moving to a balloon deployment zone
    """
    targets: Dict[str, Optional[str]] = {}
    active = [
        v for v in victims_raw.values()
        if v.get("status") not in ("rescued", "dead")
    ]
    # Sort by urgency: highest damage_per_step first
    active.sort(key=lambda v: -v.get("damage_per_step", 0))

    # Relay UAVs that serve as balloon carriers
    _relay_carrier_ids = {"UAV-11", "UAV-12", "UAV-13"}
    # Transport UGVs that serve as balloon carriers
    _transport_ugv_ids = {"UGV-5", "UGV-6"}
    # Clearing UGVs
    _clear_ugv_ids = {"UGV-3", "UGV-4"}

    uav_idx = 0
    ugv_idx = 0
    for agent in agents:
        if agent.health_status == HealthStatus.OFFLINE:
            targets[agent.agent_id] = None
            continue

        if agent.agent_type == AgentType.BALLOON:
            # Balloon moves independently after deployment (handled in _move_agents)
            targets[agent.agent_id] = None

        elif agent.agent_type == AgentType.UAV:
            if agent.agent_id in _relay_carrier_ids:
                # Relay carrier UAV: primary job is balloon deployment
                deploy_tgt = _get_carrier_current_target(agent.agent_id)
                if deploy_tgt is not None:
                    targets[agent.agent_id] = f"__deploy_{deploy_tgt[0]}_{deploy_tgt[1]}"
                else:
                    targets[agent.agent_id] = None
            else:
                # Scout UAVs: fly toward active victims
                if uav_idx < len(active):
                    targets[agent.agent_id] = active[uav_idx]["id"]
                    uav_idx += 1
                else:
                    targets[agent.agent_id] = None

        else:  # UGV
            if agent.agent_id in _transport_ugv_ids:
                # Transport UGVs: balloon deployment route
                deploy_tgt = _get_carrier_current_target(agent.agent_id)
                if deploy_tgt is not None:
                    targets[agent.agent_id] = f"__deploy_{deploy_tgt[0]}_{deploy_tgt[1]}"
                else:
                    # All balloons deployed — fall through to rescue support
                    if ugv_idx < len(active):
                        targets[agent.agent_id] = active[min(ugv_idx, len(active)-1)]["id"]
                        ugv_idx += 1
                    else:
                        targets[agent.agent_id] = None

            elif agent.agent_id in _clear_ugv_ids:
                # Clearing UGVs: clear blockades first, then rescue
                has_blocked = any(b.get("status") == "blocked" for b in blocked_cells)
                if has_blocked:
                    blocked = [b for b in blocked_cells if b.get("status") == "blocked"]
                    targets[agent.agent_id] = f"__block_{blocked[0]['id']}"
                else:
                    if ugv_idx < len(active):
                        targets[agent.agent_id] = active[min(ugv_idx, len(active)-1)]["id"]
                        ugv_idx += 1
                    else:
                        targets[agent.agent_id] = None

            else:
                # Rescue UGVs (UGV-1, UGV-2, UGV-7, UGV-8)
                if ugv_idx < len(active):
                    targets[agent.agent_id] = active[min(ugv_idx, len(active)-1)]["id"]
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
    hub_events: List[dict],
):
    """Move all agents one step and handle balloon deployment releases."""
    blocked_set = {b["id"]: b for b in blocked_cells}

    # Build position lookup for carriers (used to move undeployed balloons)
    agent_by_id = {a.agent_id: a for a in agents}

    # ── Move non-balloon agents first ────────────────────────────────────────
    for agent in agents:
        if agent.health_status == HealthStatus.OFFLINE:
            continue
        if agent.agent_type == AgentType.BALLOON:
            continue  # handled below

        speed = agent.max_speed_mps / CELL_SIZE_M

        target_id = targets.get(agent.agent_id)
        if target_id is None:
            continue

        if target_id.startswith("__block_"):
            block_id = target_id[len("__block_"):]
            if block_id in blocked_set:
                b = blocked_set[block_id]
                tx, ty = b["location"]
                agent.position = _step_toward(agent.position, tx, ty, speed)
            continue

        if target_id.startswith("__deploy_"):
            # Move carrier toward balloon deployment point
            # Format: "__deploy_X_Y" e.g. "__deploy_15_10"
            coords = target_id[len("__deploy_"):].split("_")
            tx, ty = float(coords[0]), float(coords[1])
            agent.position = _step_toward(agent.position, tx, ty, speed)

            # Check if carrier reached deployment point → release next balloon
            cur_cx = agent.position.x / CELL_SIZE_M
            cur_cy = agent.position.y / CELL_SIZE_M
            route = CARRIER_ROUTES.get(agent.agent_id, [])
            idx = _carrier_deploy_idx.get(agent.agent_id, 0)
            if idx < len(route):
                bal_id, deploy_xy = route[idx]
                if (not _balloon_deployed.get(bal_id, True)
                        and _grid_dist(cur_cx, cur_cy, deploy_xy[0], deploy_xy[1]) < 1.5):
                    _balloon_deployed[bal_id] = True
                    _carrier_deploy_idx[agent.agent_id] = idx + 1
                    hub_events.append({
                        "type": "balloon_deployed",
                        "description": (
                            f"🎈 {bal_id}(气球) 已由 {agent.agent_id} 投放，"
                            f"覆盖范围扩大。覆盖直至高固扩大。"
                        ),
                        "agents_involved": [agent.agent_id, bal_id],
                    })
            continue

        # Move toward victim
        victim = victims_raw.get(target_id)
        if victim is None or victim.get("status") in ("rescued", "dead"):
            continue
        tx, ty = victim["location"]
        agent.position = _step_toward(agent.position, tx, ty, speed)

    # ── Move balloon agents ───────────────────────────────────────────────────
    for agent in agents:
        if agent.health_status == HealthStatus.OFFLINE:
            continue
        if agent.agent_type != AgentType.BALLOON:
            continue

        speed = agent.max_speed_mps / CELL_SIZE_M

        bal_id = agent.agent_id
        if not _balloon_deployed.get(bal_id, False):
            # Undeployed: follow carrier's current position
            carrier_id = BALLOON_CARRIER.get(bal_id)
            carrier = agent_by_id.get(carrier_id) if carrier_id else None
            if carrier and carrier.health_status != HealthStatus.OFFLINE:
                agent.position = Coordinate3D(
                    carrier.position.x + random.uniform(-3, 3),
                    carrier.position.y + random.uniform(-3, 3),
                    agent.position.z,
                )
        else:
            # Deployed: drift toward own deploy_target from scenario data, then hover
            # We store the target in the deploy plan
            deploy_xy = None
            carrier_id = BALLOON_CARRIER.get(bal_id)
            for b_id, tgt in CARRIER_ROUTES.get(carrier_id or "", []):
                if b_id == bal_id:
                    deploy_xy = tgt
                    break
            if deploy_xy is not None:
                tx, ty = deploy_xy
                cur_cx = agent.position.x / CELL_SIZE_M
                cur_cy = agent.position.y / CELL_SIZE_M
                if _grid_dist(cur_cx, cur_cy, tx, ty) > 0.8:
                    agent.position = _step_toward(agent.position, tx, ty, speed)
                else:
                    # Hovering — tiny drift for realism
                    agent.position = Coordinate3D(
                        agent.position.x + random.uniform(-0.3, 0.3),
                        agent.position.y + random.uniform(-0.3, 0.3),
                        agent.position.z,
                    )


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

    # Initialise balloon deployment tracking
    _init_balloon_state(raw)

    map_data      = raw.get("map", {})
    map_size      = map_data.get("size", [30, 30])
    blocked_cells = map_data.get("blocked_cells", [])
    risk_zones    = map_data.get("risk_zones", [])
    dead_zones    = map_data.get("communication_dead_zones", [])

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
            agents, victims_raw, blocked_cells, step, map_size
        )
        _move_agents(agents, victims_raw, targets, blocked_cells, map_size, step,
                     hub_events)

        # ── 4. Battery drain ──────────────────────────────────────────────
        for agent in agents:
            if agent.health_status != HealthStatus.OFFLINE:
                agent._drain_battery()

        # ── 5. Blockade clearing (UGV-3, UGV-4) ──────────────────────────
        for agent in agents:
            if agent.agent_id in ("UGV-3", "UGV-4"):
                for b in blocked_cells:
                    if b.get("status") == "blocked":
                        bx, by = b["location"]
                        dist = _grid_dist(
                            agent.position.x / CELL_SIZE_M,
                            agent.position.y / CELL_SIZE_M,
                            bx, by,
                        )
                        if dist < 1.5:
                            clear_rate = b.get("clear_rate", 20)
                            # UGV-3 and UGV-4 working together clears faster
                            both = sum(
                                1 for a2 in agents
                                if a2.agent_id in ("UGV-3", "UGV-4")
                                and _grid_dist(
                                    a2.position.x / CELL_SIZE_M,
                                    a2.position.y / CELL_SIZE_M,
                                    bx, by
                                ) < 1.5
                            )
                            b["clear_progress"] = min(
                                100,
                                b.get("clear_progress", 0) + clear_rate * both
                            )
                            if b["clear_progress"] >= 100:
                                b["status"] = "cleared"
                                hub_events.append({
                                    "type": "blockade_cleared",
                                    "description": (
                                        f"🚧 障碍 {b['id']} 已清除，"
                                        f"地面通道开放（{agent.agent_id}）"
                                    ),
                                    "agents_involved": [agent.agent_id],
                                })

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

        # ── 8. External comm restoration milestone (when enough balloons up) ─
        deployed_count = sum(1 for v in _balloon_deployed.values() if v)
        if deployed_count >= 10 and not any(
            e.get("type") == "comm_restored" for f in frames for e in f.get("events", [])
        ):
            hub_events.append({
                "type": "comm_restored",
                "description": (
                    f"📡 {deployed_count}个气球已部署，"
                    f"通过气球中继成功建立外部通信链路"
                ),
                "agents_involved": [
                    bal_id for bal_id, dep in _balloon_deployed.items() if dep
                ][:3],
            })

        # ── 9. Build hub communication links for visualization ─────────────
        # Within-hub links: every pair of members in the same hub
        # Inter-hub links: one representative link between hub leaders
        comm_links = []
        agent_pos_map = {
            a.agent_id: [
                round(a.position.x / CELL_SIZE_M, 2),
                round(a.position.y / CELL_SIZE_M, 2),
            ]
            for a in agents if a.health_status != HealthStatus.OFFLINE
        }
        for hub in hubs:
            members_ids = [m.agent_id for m in hub.members
                           if m.health_status != HealthStatus.OFFLINE]
            # Intra-hub mesh links
            for i in range(len(members_ids)):
                for j in range(i + 1, len(members_ids)):
                    a_id, b_id = members_ids[i], members_ids[j]
                    if a_id in agent_pos_map and b_id in agent_pos_map:
                        comm_links.append({
                            "from": a_id,
                            "to":   b_id,
                            "type": "intra_hub",
                        })
        # Inter-hub links between leaders
        leader_ids = [h._leader_id for h in hubs if h._leader_id in agent_pos_map]
        for i in range(len(leader_ids)):
            for j in range(i + 1, len(leader_ids)):
                comm_links.append({
                    "from": leader_ids[i],
                    "to":   leader_ids[j],
                    "type": "inter_hub",
                })
        # UAV→UGV scout-report links (UAV is targeting a victim → report to nearest UGV)
        ugv_ids = [a.agent_id for a in agents
                   if a.agent_type == AgentType.UGV
                   and a.health_status != HealthStatus.OFFLINE]
        for agent in agents:
            if (agent.agent_type == AgentType.UAV
                    and agent.health_status != HealthStatus.OFFLINE):
                t_id = targets.get(agent.agent_id, "")
                if t_id and not t_id.startswith("__") and ugv_ids:
                    nearest_ugv = min(
                        ugv_ids,
                        key=lambda uid: _grid_dist(
                            agent_pos_map.get(agent.agent_id, [0,0])[0],
                            agent_pos_map.get(agent.agent_id, [0,0])[1],
                            agent_pos_map.get(uid, [0,0])[0],
                            agent_pos_map.get(uid, [0,0])[1],
                        )
                    )
                    comm_links.append({
                        "from": agent.agent_id,
                        "to":   nearest_ugv,
                        "type": "scout_report",
                    })
        # Balloon→hub relay links (deployed balloons relay data to nearest hub member)
        for agent in agents:
            if (agent.agent_type == AgentType.BALLOON
                    and _balloon_deployed.get(agent.agent_id, False)
                    and agent.health_status != HealthStatus.OFFLINE):
                all_hub_members = [
                    m.agent_id for hub in hubs for m in hub.members
                    if m.health_status != HealthStatus.OFFLINE
                    and m.agent_id in agent_pos_map
                ]
                if all_hub_members:
                    nearest = min(
                        all_hub_members,
                        key=lambda uid: _grid_dist(
                            agent_pos_map.get(agent.agent_id, [0,0])[0],
                            agent_pos_map.get(agent.agent_id, [0,0])[1],
                            agent_pos_map.get(uid, [0,0])[0],
                            agent_pos_map.get(uid, [0,0])[1],
                        )
                    )
                    comm_links.append({
                        "from": agent.agent_id,
                        "to":   nearest,
                        "type": "balloon_relay",
                    })

        # ── 10. Serialize frame ───────────────────────────────────────────
        hp_max_map = {
            v["id"]: v.get("hp", 10000) for v in raw.get("victims", [])
        }
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
            frame_agents.append({
                **agent.to_dict(),
                "location": [
                    round(agent.position.x / CELL_SIZE_M, 2),
                    round(agent.position.y / CELL_SIZE_M, 2),
                ],
                "target": targets.get(agent.agent_id),
                "thinking": "",
                # balloon deployment state for frontend rendering
                "deployed": _balloon_deployed.get(agent.agent_id, True)
                            if agent.agent_type == AgentType.BALLOON else None,
                "carrier_id": BALLOON_CARRIER.get(agent.agent_id)
                              if agent.agent_type == AgentType.BALLOON else None,
            })

        frames.append({
            "step": step,
            "agents": frame_agents,
            "victims": frame_victims,
            "hubs": [h.to_dict() for h in hubs],
            "comm_links": comm_links,
            "blocked_cells": [
                {k: v for k, v in b.items() if k != "_alerted_40"}
                for b in blocked_cells
            ],
            "events": hub_events,
            "briefing": _generate_briefing(
                step, agents, victims_raw, rescued_count, sacrificed_count
            ),
            "thinking_log": thinking_log,
            "stats": {
                "rescued": rescued_count,
                "sacrificed": sacrificed_count,
                "active_agents": sum(
                    1 for a in agents if a.health_status != HealthStatus.OFFLINE
                ),
                "comm_coverage_pct": _calc_comm_coverage(agents, map_size),
                "balloons_deployed": deployed_count,
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
