"""
A.R.C. Large-Scale Scenario Builder
====================================
双库房 · 大规模灾难场景生成器

配置 (严格按照 无人器设置.txt):
  - 地图: 100×100 格, 每格 10m → 1km × 1km
  - 两个库房: BASE-A [4,4]（西北）, BASE-B [95,95]（东南）
  - 每库房: 1台发电机 (电量适中), 无人器平均分配
  - UAV  × 15  (空中侦察 + 临时通信中继)
  - UGV  × 8   (地面运输 + 投放气球 + 电力中枢)
  - Balloon × 20 (初始由UGV携带, 到达部署点后展开)
  - 受灾者 × 200 (全部初始状态 unknown, 需UAV巡视发现)
  - 温湿度随机 (影响生存概率计算)

用法:
    python -m arc_core.simulation.build_large_scenario
    python -m arc_core.simulation.build_large_scenario --seed 2026 --output arc_core/simulation/data/scenario_large.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

from arc_core.paths import SIMULATION_DATA_DIR

# ---------------------------------------------------------------------------
# Configurable top-level parameters
# ---------------------------------------------------------------------------
MAP_COLS      = 100
MAP_ROWS      = 100
CELL_SIZE_M   = 10

BASE_A        = [4, 4]       # 西北角库房
BASE_B        = [95, 95]     # 东南角库房
GEN_BATTERY_A = 68           # 库房A发电机电量%
GEN_BATTERY_B = 72           # 库房B发电机电量%

N_UAV         = 15
N_UGV         = 8
N_BALLOON     = 20
N_VICTIMS     = 200

# 无人器能力 (来自 无人器设置.txt)
UAV_CFG = {
    "type": "drone", "speed": 3, "perception_range": 7,
    "sensors": ["thermal", "camera", "audio", "vibration"],
    "battery_drain_per_step": 2.2,   # % per step，续航短
    "comm_range": 8,
    "can_deploy_balloon": False,
    "gemma_model": "E2B",
    "note": "空中侦察+临时通信中继，速度快但续航短",
}
UGV_CFG = {
    "type": "ground_vehicle", "speed": 1, "perception_range": 3,
    "sensors": ["audio", "vibration", "camera"],
    "battery_drain_per_step": 0.3,   # % per step，续航极长
    "comm_range": 12,
    "can_deploy_balloon": True,       # 规则22: 气球需由无人车投放
    "can_charge_others": True,        # 规则10: 无人车是电力中枢
    "solar_recharge_per_step": 0.15,  # 太阳能补充
    "payload_kg": 200,
    "gemma_model": "E4B",
    "note": "地面运输+投放气球+太阳能充电站，载荷大但速度慢",
}
BALLOON_CFG = {
    "type": "balloon", "speed": 0,   # 投放后固定悬停
    "perception_range": 15,
    "sensors": ["thermal", "camera"],
    "battery_drain_per_step": 0.05,  # % per step，续航极长
    "comm_range": 18,
    "deployed_by_ugv": True,          # 规则22
    "gemma_model": "E2B",
    "note": "固定区域大范围监控+中长期通信中继，需无人车投放",
}

# 伤情类型 → 基础死亡加速因子
INJURY_TYPES = {
    "none":               {"dmg_mult": 0.5,  "label": "无明显外伤"},
    "minor_laceration":   {"dmg_mult": 0.8,  "label": "轻度裂伤"},
    "fracture":           {"dmg_mult": 1.2,  "label": "骨折"},
    "head_trauma":        {"dmg_mult": 2.0,  "label": "头部创伤"},
    "internal_bleeding":  {"dmg_mult": 2.5,  "label": "内出血"},
    "crush_injury":       {"dmg_mult": 2.0,  "label": "挤压伤"},
    "smoke_inhalation":   {"dmg_mult": 1.5,  "label": "烟雾吸入"},
    "hypothermia":        {"dmg_mult": 1.3,  "label": "低温症"},
    "dehydration":        {"dmg_mult": 1.0,  "label": "脱水"},
}

# ---------------------------------------------------------------------------
# Survival probability model (规则14 / 规则20)
# ---------------------------------------------------------------------------

def compute_survival_score(
    age: int,
    gender: str,
    injury: str,
    local_temp: float,
    local_humidity: float,
    trapped_hours: float,
    buriedness: int,       # 0-100
    group_size: int,
) -> float:
    """
    S = w_env*F_env + w_phys*F_phys + w_time*F_time + w_social*F_social
    返回 0.0~1.0，越高越安全。
    """
    # ── F_env: 环境因素 ───────────────────────────────────────────────────
    # 温度：15~35°C 最佳，偏离越远越差
    temp_score = max(0, 1 - abs(local_temp - 25) / 25)
    # 湿度：40~70% 最佳
    hum_score  = max(0, 1 - abs(local_humidity - 55) / 45)
    # 掩埋度：越高越差
    bury_score = 1 - buriedness / 100
    F_env = (temp_score * 0.35 + hum_score * 0.25 + bury_score * 0.40)

    # ── F_phys: 生理因素 ──────────────────────────────────────────────────
    # 年龄曲线：20~40岁最佳，儿童/老人脆弱
    if age <= 10:
        age_score = 0.55
    elif age <= 18:
        age_score = 0.80
    elif age <= 40:
        age_score = 1.00
    elif age <= 60:
        age_score = 0.85
    elif age <= 70:
        age_score = 0.65
    else:
        age_score = 0.45
    # 性别：轻微差异
    gender_mult = 0.97 if gender == "F" and age > 60 else 1.0
    # 伤情
    inj_mult = INJURY_TYPES.get(injury, {"dmg_mult": 1.0})["dmg_mult"]
    inj_score = max(0.05, 1 - (inj_mult - 0.5) / 2.5)
    F_phys = age_score * gender_mult * inj_score

    # ── F_time: 时间因素 ──────────────────────────────────────────────────
    # 每小时生存率衰减（黄金72小时）
    time_score = math.exp(-trapped_hours / 36)   # e^-1 ≈ 0.37 at 36h
    F_time = min(1.0, time_score)

    # ── F_social: 社会因素 ────────────────────────────────────────────────
    # 团体互助：人多略有优势
    social_score = min(1.0, 0.6 + group_size * 0.08)
    F_social = social_score

    score = (0.25 * F_env + 0.25 * F_phys + 0.35 * F_time + 0.15 * F_social)
    return round(min(1.0, max(0.01, score)), 3)


def survival_score_to_hp_and_dmg(
    score: float,
    injury: str,
    rng: random.Random,
) -> tuple[int, int]:
    """将生存分数转换为仿真用的 HP 和 damage_per_step。"""
    hp_base = int(score * 9000 + 1000)            # 1000~10000
    hp = hp_base + rng.randint(-500, 500)
    hp = max(500, min(10000, hp))

    inj_mult = INJURY_TYPES.get(injury, {"dmg_mult": 1.0})["dmg_mult"]
    dmg_base = int((1 - score) * 80 * inj_mult + 5)
    dmg = max(5, min(150, dmg_base + rng.randint(-10, 10)))
    return hp, dmg


# ---------------------------------------------------------------------------
# Position helpers
# ---------------------------------------------------------------------------

def _well_spread_positions(n: int, rng: random.Random, margin: int = 6) -> list:
    """Generate n positions spread across the map, avoiding base margins."""
    cols, rows = MAP_COLS, MAP_ROWS
    # Divide map into grid sectors and sample one position per sector
    sectors_per_side = max(1, int(math.sqrt(n * 1.5)))
    positions = []
    seen = set()
    attempts = 0
    while len(positions) < n and attempts < 5000:
        attempts += 1
        c = rng.randint(margin, cols - margin - 1)
        r = rng.randint(margin, rows - margin - 1)
        # Avoid both bases proximity
        if abs(c - BASE_A[0]) < 5 and abs(r - BASE_A[1]) < 5:
            continue
        if abs(c - BASE_B[0]) < 5 and abs(r - BASE_B[1]) < 5:
            continue
        key = (c // 5, r // 5)   # 5-cell bucket for spread
        if key in seen and len(positions) < n * 0.8:
            continue
        seen.add(key)
        positions.append([c, r])
    # Fill remaining if needed
    while len(positions) < n:
        positions.append([rng.randint(margin, cols-margin-1),
                           rng.randint(margin, rows-margin-1)])
    return positions[:n]


# ---------------------------------------------------------------------------
# Agent builder
# ---------------------------------------------------------------------------

def _build_agents(rng: random.Random) -> list:
    agents = []

    # Split between BASE-A and BASE-B
    uav_a  = N_UAV     // 2 + N_UAV     % 2   # 8 UAVs at A
    uav_b  = N_UAV     // 2                    # 7 UAVs at B
    ugv_a  = N_UGV     // 2                    # 4 UGVs at A
    ugv_b  = N_UGV     // 2                    # 4 UGVs at B
    bal_a  = N_BALLOON // 2                    # 10 Balloons at A
    bal_b  = N_BALLOON // 2                    # 10 Balloons at B

    def base_offset(base, idx, row_offset=0):
        """Stagger agents near a base."""
        return [base[0] + (idx % 5), base[1] + row_offset + idx // 5]

    # ── UAVs ─────────────────────────────────────────────────────────────
    uav_roles = ["scout", "scout", "relay", "scout", "scout",
                 "scout", "relay", "scout", "scout", "scout",
                 "scout", "relay", "scout", "scout", "relay"]
    for i in range(N_UAV):
        base  = BASE_A if i < uav_a else BASE_B
        local_i = i if i < uav_a else i - uav_a
        bat = rng.randint(55, 90)
        agents.append({
            "id":              f"Drone-{i+1:02d}",
            "type":            UAV_CFG["type"],
            "role":            uav_roles[i],
            "base":            "BASE-A" if i < uav_a else "BASE-B",
            "location":        base_offset(base, local_i, 0),
            "battery":         bat,
            "speed":           UAV_CFG["speed"],
            "perception_range": UAV_CFG["perception_range"],
            "comm_range":      UAV_CFG["comm_range"],
            "sensors":         UAV_CFG["sensors"],
            "battery_drain_per_step": UAV_CFG["battery_drain_per_step"],
            "can_deploy_balloon": UAV_CFG["can_deploy_balloon"],
            "gemma_model":     UAV_CFG["gemma_model"],
            "payload":         "medical_beacon" if i % 3 == 0 else "radio_relay",
            "note":            UAV_CFG["note"],
        })

    # ── UGVs ─────────────────────────────────────────────────────────────
    ugv_roles = ["rescue", "clear_blockade", "rescue", "clear_blockade",
                 "rescue", "clear_blockade", "rescue", "clear_blockade"]
    for i in range(N_UGV):
        base  = BASE_A if i < ugv_a else BASE_B
        local_i = i if i < ugv_a else i - ugv_a
        bat = rng.randint(60, 85)
        agents.append({
            "id":              f"UGV-{i+1:02d}",
            "type":            "ground_rescue" if ugv_roles[i] == "rescue" else "ground_clear",
            "role":            ugv_roles[i],
            "base":            "BASE-A" if i < ugv_a else "BASE-B",
            "location":        base_offset(base, local_i, 3),
            "battery":         bat,
            "speed":           UGV_CFG["speed"],
            "perception_range": UGV_CFG["perception_range"],
            "comm_range":      UGV_CFG["comm_range"],
            "sensors":         UGV_CFG["sensors"],
            "battery_drain_per_step": UGV_CFG["battery_drain_per_step"],
            "can_charge_others": UGV_CFG["can_charge_others"],
            "solar_recharge_per_step": UGV_CFG["solar_recharge_per_step"],
            "can_deploy_balloon": UGV_CFG["can_deploy_balloon"],
            "clear_rate":      20,
            "payload_kg":      UGV_CFG["payload_kg"],
            "payload":         "first_aid_pack" if ugv_roles[i] == "rescue" else "rubble_clear_tool",
            "gemma_model":     UGV_CFG["gemma_model"],
            "note":            UGV_CFG["note"],
        })

    # ── Balloons ──────────────────────────────────────────────────────────
    # 规则22: 气球由无人车投放，初始状态 "not_deployed"，在库房等待
    for i in range(N_BALLOON):
        base  = BASE_A if i < bal_a else BASE_B
        local_i = i if i < bal_a else i - bal_a
        bat = rng.randint(88, 98)
        agents.append({
            "id":              f"Balloon-{i+1:02d}",
            "type":            BALLOON_CFG["type"],
            "role":            "relay",
            "base":            "BASE-A" if i < bal_a else "BASE-B",
            "location":        base_offset(base, local_i, 6),
            "battery":         bat,
            "speed":           BALLOON_CFG["speed"],
            "perception_range": BALLOON_CFG["perception_range"],
            "comm_range":      BALLOON_CFG["comm_range"],
            "sensors":         BALLOON_CFG["sensors"],
            "battery_drain_per_step": BALLOON_CFG["battery_drain_per_step"],
            "deployed_by_ugv": BALLOON_CFG["deployed_by_ugv"],
            "deployment_status": "not_deployed",  # 规则22: 等待无人车投放
            "gemma_model":     BALLOON_CFG["gemma_model"],
            "payload":         "comm_relay",
            "note":            BALLOON_CFG["note"],
        })

    return agents


# ---------------------------------------------------------------------------
# Victim builder (200 victims, 规则14/20/21)
# ---------------------------------------------------------------------------

def _build_victims(rng: random.Random) -> list:
    positions = _well_spread_positions(N_VICTIMS, rng, margin=6)

    genders  = ["M", "F"]
    injuries = list(INJURY_TYPES.keys())
    # Weighted injury distribution (most are minor)
    inj_weights = [20, 25, 18, 8, 5, 7, 10, 4, 3]

    victims = []
    for i in range(N_VICTIMS):
        age     = int(rng.triangular(5, 85, 38))   # peak around 38
        gender  = rng.choice(genders)
        injury  = rng.choices(injuries, weights=inj_weights, k=1)[0]
        group   = rng.choices([1, 1, 1, 2, 3, 4], weights=[50,20,15,8,5,2], k=1)[0]

        # Local micro-environment (varies per victim location)
        local_temp  = round(rng.uniform(12, 42), 1)   # extreme temps possible
        local_hum   = round(rng.uniform(18, 96), 1)
        trapped_h   = round(rng.uniform(0.5, 68), 1)  # 0.5~68 hours trapped
        buriedness  = rng.randint(0, 95)

        # Survival score (规则14 公式)
        score = compute_survival_score(
            age, gender, injury, local_temp, local_hum,
            trapped_h, buriedness, group,
        )

        hp, dmg = survival_score_to_hp_and_dmg(score, injury, rng)

        # 规则21: 所有受灾者初始状态为 unknown，需无人机发现
        # 信号值初始为0，被UAV发现后才更新
        thermal  = round(rng.uniform(0.25, 0.95), 2)  # 传感器真实值(内部存储)
        audio    = round(rng.uniform(0.10, 0.90), 2)
        vibration= round(rng.uniform(0.10, 0.92), 2)

        victims.append({
            "id":               f"V{i+1:03d}",
            "location":         positions[i],
            # 规则21: 初始 unknown，坐标对无人器不可见
            "status":           "unknown",
            "discovered":       False,

            # ── 仿真用 ──
            "hp":               hp,
            "damage_per_step":  dmg,
            "survival_score":   score,

            # ── 个人信息 (规则14 / 规则20) ──
            "age":              age,
            "gender":           gender,
            "injury_type":      injury,
            "injury_label":     INJURY_TYPES[injury]["label"],
            "group_size":       group,
            "trapped_duration_h": trapped_h,
            "buriedness":       buriedness,

            # ── 局部环境 (规则14 环境因素) ──
            "local_temp_c":     local_temp,
            "local_humidity_pct": local_hum,

            # ── 传感器信号 (初始0，发现后解锁) ──
            "thermal_signal":   0.0,
            "audio_signal":     0.0,
            "vibration_signal": 0.0,
            # 真实信号值 (UAV扫描时填入)
            "_true_thermal":    thermal,
            "_true_audio":      audio,
            "_true_vibration":  vibration,
        })

    # 按生存分从低到高排序，让优先级计算更明显
    victims.sort(key=lambda v: v["survival_score"])
    return victims


# ---------------------------------------------------------------------------
# Map features
# ---------------------------------------------------------------------------

def _build_map_features(rng: random.Random) -> dict:
    # 路障: 密集在地图中部
    n_blocked = 18
    blocked = []
    for i in range(n_blocked):
        c = rng.randint(20, 80)
        r = rng.randint(20, 80)
        blocked.append({
            "id":             f"K{i+1:02d}",
            "location":       [c, r],
            "repair_cost":    rng.randint(30, 100),
            "clear_progress": 0,
            "status":         "blocked",
        })

    # 风险区
    risk_type_pool = ["collapse", "fire", "flood", "landslide", "collapse", "fire"]
    n_risk = 12
    risk_zones = []
    for i in range(n_risk):
        c = rng.randint(10, 90)
        r = rng.randint(10, 90)
        risk_zones.append({
            "id":     f"Z{i+1:02d}",
            "center": [c, r],
            "radius": rng.randint(2, 6),
            "type":   rng.choice(risk_type_pool),
            "risk":   round(rng.uniform(0.4, 0.9), 2),
        })

    # 通信死区
    n_dead = 6
    dead_zones = []
    for i in range(n_dead):
        c = rng.randint(15, 85)
        r = rng.randint(15, 85)
        dead_zones.append({
            "id":               f"C{i+1:02d}",
            "center":           [c, r],
            "radius":           rng.randint(4, 8),
            "dropout_addition": round(rng.uniform(0.25, 0.50), 2),
        })

    return {
        "blocked_cells":            blocked,
        "risk_zones":               risk_zones,
        "communication_dead_zones": dead_zones,
    }


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build(seed: int = 2026) -> dict:
    rng = random.Random(seed)

    # Global weather (规则14)
    weather = {
        "temperature_c":   round(rng.uniform(10, 38), 1),
        "humidity_pct":    round(rng.uniform(25, 92), 1),
        "wind_speed_mps":  round(rng.uniform(0, 22),  1),
        "rainfall_mmh":    round(rng.uniform(0, 45),  1) if rng.random() > 0.4 else 0,
        "visibility_m":    round(rng.uniform(50, 1000), 0),
        "air_quality_aqi": round(rng.uniform(30, 280), 0),
    }

    map_features = _build_map_features(rng)
    agents  = _build_agents(rng)
    victims = _build_victims(rng)

    # 按生存分最低的前10个标为 "trapped"（已被初步确认），其余 unknown
    for i, v in enumerate(victims):
        if i < 10:
            v["status"] = "trapped"
            v["thermal_signal"]   = v["_true_thermal"]
            v["audio_signal"]     = v["_true_audio"]
            v["vibration_signal"] = v["_true_vibration"]
            v["discovered"] = True

    return {
        "scenario_id": "mega_disaster_001",
        "description": (
            "大规模复合灾难：地震引发建筑倒塌与局部山火，"
            "城郊双库房协同救援，200名受灾者分散于1km²区域"
        ),
        "seed": seed,
        "map": {
            "size":        [MAP_COLS, MAP_ROWS],
            "cell_size_m": CELL_SIZE_M,
            # 双库房 (规则9: 发电机 + 无人器仓)
            "bases": [
                {
                    "id":                "BASE-A",
                    "location":          BASE_A,
                    "label":             "西北指挥仓库",
                    "generator_battery": GEN_BATTERY_A,
                    "description":       f"库房A — 发电机电量{GEN_BATTERY_A}%",
                },
                {
                    "id":                "BASE-B",
                    "location":          BASE_B,
                    "label":             "东南指挥仓库",
                    "generator_battery": GEN_BATTERY_B,
                    "description":       f"库房B — 发电机电量{GEN_BATTERY_B}%",
                },
            ],
            # 保持向后兼容：base 字段指向第一个库房
            "base":    BASE_A,
            "refuges": [
                {"id": "R0", "location": BASE_A},
                {"id": "R1", "location": BASE_B},
            ],
            **map_features,
        },
        "weather": weather,
        "victims": victims,
        "agents":  agents,
        "communication": {
            "base_range":               14,
            "relay_range":              10,
            "direct_comm_range":        5,
            "bandwidth_limit":          8,
            "base_dropout_probability": 0.12,
        },
        "arc_rules": {
            "hub_min_agents":          3,
            "sacrifice_threshold":     0.30,
            "uav_discovers_victims":   True,   # 规则21
            "balloons_need_ugv_deploy": True,  # 规则22
            "ugv_is_power_hub":        True,   # 规则10
            "survival_model":          "weighted_4factor",  # 规则14
        },
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="A.R.C. Large Scenario Builder")
    parser.add_argument("--seed",   type=int,  default=2026, help="随机种子")
    parser.add_argument(
        "--output", type=Path,
        default=SIMULATION_DATA_DIR / "scenario_large.json",
    )
    args = parser.parse_args()

    print("[build_large_scenario] Building mega scenario...")
    data = build(seed=args.seed)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    agents  = data["agents"]
    victims = data["victims"]
    uavs     = [a for a in agents if a["type"] == "drone"]
    ugvs     = [a for a in agents if "ground" in a["type"]]
    balloons = [a for a in agents if a["type"] == "balloon"]

    w = data["weather"]
    scores = [v["survival_score"] for v in victims]
    critical = [v for v in victims if v["survival_score"] < 0.3]
    severe   = [v for v in victims if 0.3 <= v["survival_score"] < 0.55]
    moderate = [v for v in victims if 0.55 <= v["survival_score"] < 0.75]
    stable   = [v for v in victims if v["survival_score"] >= 0.75]

    print(f"\n[OK] Scenario written: {args.output}")
    print(f"\n  == Map ==")
    print(f"     Size      : {MAP_COLS}x{MAP_ROWS} grid ({MAP_COLS*CELL_SIZE_M//1000}km x {MAP_ROWS*CELL_SIZE_M//1000}km)")
    print(f"     BASE-A    : {BASE_A}  (generator {GEN_BATTERY_A}%)")
    print(f"     BASE-B    : {BASE_B}  (generator {GEN_BATTERY_B}%)")
    print(f"     Blockades : {len(data['map']['blocked_cells'])}")
    print(f"     Risk zones: {len(data['map']['risk_zones'])}")
    print(f"     Dead zones: {len(data['map']['communication_dead_zones'])}")

    print(f"\n  == Fleet ({len(agents)} total) ==")
    print(f"     UAV     x{len(uavs):2d}  (A:{sum(1 for a in uavs if a['base']=='BASE-A')} / B:{sum(1 for a in uavs if a['base']=='BASE-B')})")
    print(f"     UGV     x{len(ugvs):2d}  (A:{sum(1 for a in ugvs if a['base']=='BASE-A')} / B:{sum(1 for a in ugvs if a['base']=='BASE-B')})")
    print(f"     Balloon x{len(balloons):2d}  (A:{sum(1 for a in balloons if a['base']=='BASE-A')} / B:{sum(1 for a in balloons if a['base']=='BASE-B')})")

    print(f"\n  == Victims ({len(victims)} total) ==")
    print(f"     Critical  (score<0.30) : {len(critical):3d} people")
    print(f"     Severe    (0.30~0.55)  : {len(severe):3d} people")
    print(f"     Moderate  (0.55~0.75)  : {len(moderate):3d} people")
    print(f"     Stable    (score>0.75) : {len(stable):3d} people")
    print(f"     Avg survival score     : {sum(scores)/len(scores):.3f}")

    print(f"\n  == Weather ==")
    print(f"     Temp     : {w['temperature_c']}°C")
    print(f"     Humidity : {w['humidity_pct']}%")
    print(f"     Wind     : {w['wind_speed_mps']} m/s")
    print(f"     Rainfall : {w['rainfall_mmh']} mm/h")
    print(f"     AQI      : {w['air_quality_aqi']}")

    print(f"\nNext step:")
    print(f"  python -m arc_core.simulation.timeline_generator --scenario {args.output} --steps 300 --output demo_player/timeline.json")
