"""
A.R.C. Scenario Builder — 交互式受灾场景生成器

用法:
    python -m simulation.scenario_builder                  # 交互模式
    python -m simulation.scenario_builder --preset flood   # 预设场景
    python -m simulation.scenario_builder --output ARC_2026-arc-lite-2d-demo/scenario_002.json

支持的预设: earthquake (默认) | flood | fire | landslide
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

# ---------------------------------------------------------------------------
# 可调参数说明 (所有参数均有默认值，可按需覆盖)
# ---------------------------------------------------------------------------

PARAM_DOCS = """
┌──────────────────────────────────────────────────────────────────────────┐
│                       A.R.C. 场景参数说明                                │
├─────────────────┬────────────────────────────────────────────────────────┤
│  参数           │  说明                                                  │
├─────────────────┼────────────────────────────────────────────────────────┤
│ map_size        │  地图尺寸 [列, 行]，默认 [30, 30]                      │
│ cell_size_m     │  每格实际米数，默认 10m                                │
│                 │                                                        │
│ -- 无人器 --    │                                                        │
│ n_uav           │  UAV 数量 (1~4)                                        │
│ n_ugv           │  UGV 数量 (1~4)                                        │
│ n_balloon       │  Balloon 数量 (0~2)                                    │
│ uav_battery     │  UAV 初始电量 % (1~100)                               │
│ ugv_battery     │  UGV 初始电量 % (1~100)                               │
│ balloon_battery │  Balloon 初始电量 % (1~100)                           │
│                 │                                                        │
│ -- 受灾者 --    │                                                        │
│ n_victims       │  受灾者数量 (1~10)                                     │
│ victim_hp_min   │  受灾者最低 HP (1~10000)                               │
│ victim_hp_max   │  受灾者最高 HP (1~10000)                               │
│ dmg_min         │  最低每步伤损 (1~200)                                  │
│ dmg_max         │  最高每步伤损 (1~200)                                  │
│                 │                                                        │
│ -- 地图障碍 --  │                                                        │
│ n_blocked       │  路障数量 (0~6)                                        │
│ n_risk_zones    │  风险区数量 (0~4)，自动随机布局                        │
│ n_dead_zones    │  通信死区数量 (0~3)，自动随机布局                      │
│                 │                                                        │
│ -- 通信参数 --  │                                                        │
│ base_range      │  基地通信范围（格）(5~20)                              │
│ dropout_prob    │  基础通信丢包率 (0.0~0.5)                              │
└─────────────────┴────────────────────────────────────────────────────────┘
"""

# ---------------------------------------------------------------------------
# Preset definitions
# ---------------------------------------------------------------------------

PRESETS = {
    "earthquake": {
        "scenario_id": "urban_quake_002",
        "description": "6.8级地震，城市密集区，多处建筑倒塌，通信中断",
        "n_uav": 2, "n_ugv": 2, "n_balloon": 1,
        "uav_battery": [75, 50], "ugv_battery": [80, 65], "balloon_battery": [95],
        "n_victims": 5,
        "victim_hp_min": 4000, "victim_hp_max": 10000,
        "dmg_min": 30, "dmg_max": 90,
        "n_blocked": 2, "n_risk_zones": 2, "n_dead_zones": 1,
        "base_range": 12, "dropout_prob": 0.15,
        "risk_types": ["collapse", "fire"],
    },
    "flood": {
        "scenario_id": "coastal_flood_001",
        "description": "台风引发洪水，沿海低洼区，道路被淹，通信塔损毁",
        "n_uav": 3, "n_ugv": 1, "n_balloon": 2,
        "uav_battery": [90, 70, 55], "ugv_battery": [60], "balloon_battery": [98, 85],
        "n_victims": 7,
        "victim_hp_min": 5000, "victim_hp_max": 9000,
        "dmg_min": 20, "dmg_max": 70,
        "n_blocked": 3, "n_risk_zones": 3, "n_dead_zones": 2,
        "base_range": 10, "dropout_prob": 0.25,
        "risk_types": ["flood", "flood", "collapse"],
    },
    "fire": {
        "scenario_id": "wildfire_001",
        "description": "山火蔓延，林区人员被困，能见度低，通信受干扰",
        "n_uav": 4, "n_ugv": 1, "n_balloon": 1,
        "uav_battery": [85, 80, 60, 45], "ugv_battery": [70], "balloon_battery": [90],
        "n_victims": 4,
        "victim_hp_min": 3000, "victim_hp_max": 8000,
        "dmg_min": 50, "dmg_max": 120,
        "n_blocked": 1, "n_risk_zones": 4, "n_dead_zones": 2,
        "base_range": 8, "dropout_prob": 0.30,
        "risk_types": ["fire", "fire", "fire", "collapse"],
    },
    "landslide": {
        "scenario_id": "mountain_landslide_001",
        "description": "山体滑坡，山区村落被埋，地形复杂，地面通行困难",
        "n_uav": 2, "n_ugv": 2, "n_balloon": 1,
        "uav_battery": [80, 65], "ugv_battery": [90, 55], "balloon_battery": [92],
        "n_victims": 6,
        "victim_hp_min": 2000, "victim_hp_max": 9000,
        "dmg_min": 40, "dmg_max": 100,
        "n_blocked": 4, "n_risk_zones": 3, "n_dead_zones": 1,
        "base_range": 11, "dropout_prob": 0.20,
        "risk_types": ["landslide", "collapse", "landslide"],
    },
}

# ---------------------------------------------------------------------------
# Layout helpers
# ---------------------------------------------------------------------------

def _rand_pos(cols, rows, exclude=None, margin=4):
    """Random grid position avoiding base area and exclusion list."""
    exclude = exclude or []
    for _ in range(200):
        c = random.randint(margin, cols - margin - 1)
        r = random.randint(margin, rows - margin - 1)
        if (c, r) not in exclude:
            return [c, r]
    return [cols // 2, rows // 2]


def _spread_positions(n, cols, rows, margin=4):
    """Generate n well-spread positions across the map."""
    taken = set()
    positions = []
    for _ in range(n):
        pos = _rand_pos(cols, rows, taken, margin)
        taken.add(tuple(pos))
        positions.append(pos)
    return positions

# ---------------------------------------------------------------------------
# Build scenario JSON
# ---------------------------------------------------------------------------

def build_scenario(cfg: dict, seed: int = 42) -> dict:
    random.seed(seed)

    cols, rows = cfg.get("map_size", [30, 30])
    cell = cfg.get("cell_size_m", 10)
    base = [2, 2]

    n_uav     = cfg["n_uav"]
    n_ugv     = cfg["n_ugv"]
    n_balloon = cfg["n_balloon"]
    n_victims = cfg["n_victims"]

    # Pad battery lists if shorter than count
    def bat_list(key, n, default):
        b = cfg.get(key, [default] * n)
        while len(b) < n:
            b.append(default)
        return b

    uav_bats     = bat_list("uav_battery",     n_uav,     80)
    ugv_bats     = bat_list("ugv_battery",     n_ugv,     75)
    balloon_bats = bat_list("balloon_battery", n_balloon, 95)

    # ── Victim positions (well-spread, away from base) ──
    victim_positions = _spread_positions(n_victims, cols, rows, margin=4)

    victims = []
    for i in range(n_victims):
        hp  = random.randint(cfg.get("victim_hp_min", 4000), cfg.get("victim_hp_max", 10000))
        dmg = random.randint(cfg.get("dmg_min", 30),         cfg.get("dmg_max", 90))
        victims.append({
            "id":               f"V{i+1}",
            "location":         victim_positions[i],
            "hp":               hp,
            "damage_per_step":  dmg,
            "buriedness":       random.randint(10, 80),
            "thermal_signal":   round(random.uniform(0.2, 0.95), 2),
            "audio_signal":     round(random.uniform(0.1, 0.90), 2),
            "vibration_signal": round(random.uniform(0.1, 0.92), 2),
            "status":           "trapped" if random.random() > 0.15 else "unknown",
        })

    # ── Agent starting positions (cluster near base) ──
    agents = []
    agent_id = 1
    roles_uav = ["scout", "relay"] + ["scout"] * n_uav
    for i in range(n_uav):
        agents.append({
            "id":              f"Drone-{agent_id}",
            "type":            "drone",
            "role":            roles_uav[i % len(roles_uav)],
            "location":        [base[0] + i, base[1]],
            "battery":         uav_bats[i],
            "speed":           3,
            "perception_range": 6,
            "sensors":         ["thermal", "camera", "audio"],
            "payload":         "medical_beacon" if i == 0 else "radio_relay",
        })
        agent_id += 1

    roles_ugv = ["rescue", "clear_blockade"] + ["rescue"] * n_ugv
    for i in range(n_ugv):
        agents.append({
            "id":              f"UGV-{i+1}",
            "type":            "ground_rescue" if roles_ugv[i % 2] == "rescue" else "ground_clear",
            "role":            roles_ugv[i % len(roles_ugv)],
            "location":        [base[0] + i, base[1] + 1],
            "battery":         ugv_bats[i],
            "speed":           1,
            "perception_range": 3,
            "clear_rate":      20,
            "sensors":         ["audio", "vibration"] if i == 0 else ["camera"],
            "payload":         "first_aid_pack" if i == 0 else "rubble_clear_tool",
        })

    for i in range(n_balloon):
        agents.append({
            "id":              f"Balloon-{i+1}",
            "type":            "balloon",
            "role":            "relay",
            "location":        [base[0] + i, base[1] + 2 + i],
            "battery":         balloon_bats[i],
            "speed":           0.5,
            "perception_range": 12,
            "sensors":         ["thermal", "camera"],
            "payload":         "comm_relay",
        })

    # ── Blocked cells ──
    n_blocked = cfg.get("n_blocked", 2)
    blocked_positions = _spread_positions(n_blocked, cols, rows, margin=6)
    blocked_cells = [
        {
            "id":           f"K{i+1}",
            "location":     blocked_positions[i],
            "repair_cost":  random.randint(40, 100),
            "clear_progress": 0,
            "status":       "blocked",
        }
        for i in range(n_blocked)
    ]

    # ── Risk zones ──
    n_risk = cfg.get("n_risk_zones", 2)
    risk_types = cfg.get("risk_types", ["collapse"] * n_risk)
    risk_positions = _spread_positions(n_risk, cols, rows, margin=5)
    risk_zones = [
        {
            "id":     f"Z{i+1}",
            "center": risk_positions[i],
            "radius": random.randint(2, 4),
            "type":   risk_types[i % len(risk_types)],
            "risk":   round(random.uniform(0.5, 0.85), 2),
        }
        for i in range(n_risk)
    ]

    # ── Communication dead zones ──
    n_dead = cfg.get("n_dead_zones", 1)
    dead_positions = _spread_positions(n_dead, cols, rows, margin=5)
    dead_zones = [
        {
            "id":                f"C{i+1}",
            "center":            dead_positions[i],
            "radius":            random.randint(3, 5),
            "dropout_addition":  round(random.uniform(0.2, 0.45), 2),
        }
        for i in range(n_dead)
    ]

    return {
        "scenario_id":  cfg.get("scenario_id",  "custom_scenario_001"),
        "description":  cfg.get("description",  "Custom A.R.C. scenario"),
        "map": {
            "size":                   [cols, rows],
            "cell_size_m":            cell,
            "base":                   base,
            "refuges":                [{"id": "R0", "location": base}],
            "blocked_cells":          blocked_cells,
            "risk_zones":             risk_zones,
            "communication_dead_zones": dead_zones,
        },
        "victims": victims,
        "agents":  agents,
        "communication": {
            "base_range":              cfg.get("base_range",    12),
            "relay_range":             8,
            "direct_comm_range":       4,
            "bandwidth_limit":         3,
            "base_dropout_probability": cfg.get("dropout_prob", 0.15),
        },
    }

# ---------------------------------------------------------------------------
# Interactive prompt
# ---------------------------------------------------------------------------

def _ask(prompt, default, cast=str):
    raw = input(f"  {prompt} [{default}]: ").strip()
    if not raw:
        return default
    try:
        return cast(raw)
    except ValueError:
        print(f"    (输入无效，使用默认值 {default})")
        return default


def interactive_build() -> dict:
    print("\n" + PARAM_DOCS)
    print("直接按 Enter 使用默认值。\n")

    preset_name = _ask("预设场景 (earthquake/flood/fire/landslide)", "earthquake")
    cfg = dict(PRESETS.get(preset_name, PRESETS["earthquake"]))

    print(f"\n── 已载入预设: {preset_name} ──")
    print(f"   {cfg['description']}\n")
    print("现在可以覆盖任意参数（直接回车保留预设值）：\n")

    cfg["n_uav"]     = _ask("UAV 数量",     cfg["n_uav"],     int)
    cfg["n_ugv"]     = _ask("UGV 数量",     cfg["n_ugv"],     int)
    cfg["n_balloon"] = _ask("Balloon 数量", cfg["n_balloon"], int)

    uav_default = cfg["uav_battery"][:cfg["n_uav"]]
    raw = _ask(f"UAV 电量列表 (逗号分隔, 如 80,60)", ",".join(map(str, uav_default)))
    cfg["uav_battery"] = [int(x.strip()) for x in raw.split(",") if x.strip()]

    ugv_default = cfg["ugv_battery"][:cfg["n_ugv"]]
    raw = _ask(f"UGV 电量列表", ",".join(map(str, ugv_default)))
    cfg["ugv_battery"] = [int(x.strip()) for x in raw.split(",") if x.strip()]

    cfg["n_victims"]     = _ask("受灾者数量",       cfg["n_victims"],     int)
    cfg["victim_hp_min"] = _ask("受灾者最低 HP",     cfg["victim_hp_min"], int)
    cfg["victim_hp_max"] = _ask("受灾者最高 HP",     cfg["victim_hp_max"], int)
    cfg["dmg_min"]       = _ask("最低每步伤损",      cfg["dmg_min"],       int)
    cfg["dmg_max"]       = _ask("最高每步伤损",      cfg["dmg_max"],       int)
    cfg["n_blocked"]     = _ask("路障数量",          cfg["n_blocked"],     int)
    cfg["n_risk_zones"]  = _ask("风险区数量",        cfg["n_risk_zones"],  int)
    cfg["n_dead_zones"]  = _ask("通信死区数量",      cfg["n_dead_zones"],  int)
    cfg["base_range"]    = _ask("基地通信范围(格)",  cfg["base_range"],    int)
    cfg["dropout_prob"]  = _ask("基础通信丢包率",    cfg["dropout_prob"],  float)

    seed = _ask("随机种子 (控制布局可复现性)", 42, int)
    return build_scenario(cfg, seed=seed)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="A.R.C. Scenario Builder")
    parser.add_argument(
        "--preset", choices=list(PRESETS.keys()), default=None,
        help="直接使用预设，跳过交互",
    )
    parser.add_argument(
        "--output", type=Path,
        default=Path(__file__).resolve().parent.parent
                / "ARC_2026-arc-lite-2d-demo" / "scenario_002.json",
        help="输出路径",
    )
    parser.add_argument("--seed", type=int, default=42, help="随机种子")
    args = parser.parse_args()

    if args.preset:
        cfg  = dict(PRESETS[args.preset])
        data = build_scenario(cfg, seed=args.seed)
        print(f"[scenario_builder] 预设 '{args.preset}' 已生成。")
    else:
        data = interactive_build()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    agents  = data["agents"]
    victims = data["victims"]
    uavs     = [a for a in agents if a["type"].startswith("drone")]
    ugvs     = [a for a in agents if "ground" in a["type"]]
    balloons = [a for a in agents if a["type"] == "balloon"]

    print(f"\n[OK] Scene written: {args.output}")
    print(f"   ID       : {data['scenario_id']}")
    print(f"   UAV x{len(uavs)} | UGV x{len(ugvs)} | Balloon x{len(balloons)}")
    print(f"   Victims  : {len(victims)}")
    print(f"   Blocks   : {len(data['map']['blocked_cells'])}  "
          f"RiskZones: {len(data['map']['risk_zones'])}  "
          f"DeadZones: {len(data['map']['communication_dead_zones'])}")
    print(f"\nNext step:")
    print(f"  python -m simulation.timeline_generator "
          f"--scenario {args.output} "
          f"--output demo_player/timeline.json")
