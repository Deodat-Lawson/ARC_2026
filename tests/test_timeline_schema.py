"""
tests/test_timeline_schema.py
==============================
前端数据层测试：验证 timeline.json 的结构完整性与业务逻辑正确性。

运行:
    pytest tests/test_timeline_schema.py -v
    pytest tests/test_timeline_schema.py -v --tb=short
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

REPO_ROOT      = Path(__file__).resolve().parent.parent
SCENARIO_PATH  = REPO_ROOT / "ARC_2026-arc-lite-2d-demo" / "scenario_001.json"
TIMELINE_PATH  = REPO_ROOT / "demo_player" / "timeline.json"

VALID_AGENT_TYPES   = {"uav", "ugv", "balloon", "drone", "ground_rescue", "ground_clear"}
VALID_AGENT_TASKS   = {"idle", "recon", "search", "rescue", "relay",
                       "transport", "charge", "deploy_balloon", "sacrificed"}
VALID_VICTIM_STATUS = {"unknown", "trapped", "rescued", "dead"}
VALID_EVENT_TYPES   = {
    "hub_formed", "rescued", "sacrifice", "energy_transfer",
    "blockade_cleared", "balloon_deployed", "comm_restored",
    "alert", "victim_dead",
}


@pytest.fixture(scope="session")
def timeline():
    """Load (or regenerate) timeline.json once for the entire test session."""
    if not TIMELINE_PATH.exists():
        print("\n[fixture] timeline.json not found — regenerating...")
        result = subprocess.run(
            [sys.executable, "-m", "simulation.timeline_generator",
             "--steps", "80", "--output", str(TIMELINE_PATH)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            f"timeline_generator failed:\n{result.stdout}\n{result.stderr}"
        )
    return json.loads(TIMELINE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def frames(timeline):
    return timeline["frames"]


@pytest.fixture(scope="session")
def first_frame(frames):
    return frames[0]


@pytest.fixture(scope="session")
def last_frame(frames):
    return frames[-1]


@pytest.fixture(scope="session")
def scenario():
    return json.loads(SCENARIO_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# ── Group 1: Top-level structure ────────────────────────────────────────────
# ---------------------------------------------------------------------------

class TestTopLevelStructure:

    def test_has_scenario_id(self, timeline):
        assert "scenario_id" in timeline
        assert isinstance(timeline["scenario_id"], str)
        assert len(timeline["scenario_id"]) > 0

    def test_has_total_steps(self, timeline):
        assert "total_steps" in timeline
        assert isinstance(timeline["total_steps"], int)
        assert timeline["total_steps"] > 0

    def test_frames_is_list(self, timeline):
        assert "frames" in timeline
        assert isinstance(timeline["frames"], list)

    def test_frame_count_matches_total_steps(self, timeline):
        assert len(timeline["frames"]) == timeline["total_steps"]

    def test_at_least_one_frame(self, frames):
        assert len(frames) >= 1

    def test_step_numbers_are_sequential(self, frames):
        for i, frame in enumerate(frames):
            assert frame["step"] == i, (
                f"Frame index {i} has step={frame['step']}, expected {i}"
            )


# ---------------------------------------------------------------------------
# ── Group 2: Per-frame required fields ─────────────────────────────────────
# ---------------------------------------------------------------------------

REQUIRED_FRAME_KEYS = {
    "step", "agents", "victims", "hubs", "events",
    "briefing", "thinking_log", "stats",
}

class TestFrameFields:

    @pytest.mark.parametrize("key", sorted(REQUIRED_FRAME_KEYS))
    def test_frame_has_required_key(self, first_frame, key):
        assert key in first_frame, f"Frame missing required key: '{key}'"

    def test_all_frames_have_required_keys(self, frames):
        missing = []
        for frame in frames:
            for key in REQUIRED_FRAME_KEYS:
                if key not in frame:
                    missing.append(f"step={frame.get('step','?')} missing '{key}'")
        assert not missing, "\n".join(missing[:10])

    def test_stats_has_required_subkeys(self, first_frame):
        stats = first_frame["stats"]
        for key in ("rescued", "sacrificed", "active_agents", "comm_coverage_pct"):
            assert key in stats, f"stats missing '{key}'"

    def test_briefing_is_non_empty_string(self, first_frame):
        assert isinstance(first_frame["briefing"], str)
        assert len(first_frame["briefing"]) > 0

    def test_events_is_list(self, first_frame):
        assert isinstance(first_frame["events"], list)

    def test_hubs_is_list(self, first_frame):
        assert isinstance(first_frame["hubs"], list)


# ---------------------------------------------------------------------------
# ── Group 3: Agent data integrity ──────────────────────────────────────────
# ---------------------------------------------------------------------------

class TestAgentData:

    def test_agents_list_non_empty(self, first_frame):
        assert len(first_frame["agents"]) > 0

    def test_agent_count_consistent_across_frames(self, frames):
        counts = [len(f["agents"]) for f in frames]
        # Count may decrease (sacrifice), never increase
        for i in range(1, len(counts)):
            assert counts[i] <= counts[i - 1], (
                f"Agent count increased from step {i-1} to {i}: "
                f"{counts[i-1]} -> {counts[i]}"
            )

    def test_agent_has_required_fields(self, first_frame):
        for agent in first_frame["agents"]:
            for key in ("id", "type", "battery", "health", "task", "position", "location"):
                assert key in agent, f"Agent '{agent.get('id','?')}' missing '{key}'"

    def test_agent_battery_range(self, frames):
        bad = []
        for frame in frames:
            for agent in frame["agents"]:
                b = agent["battery"]
                if not (0.0 <= b <= 1.0):
                    bad.append(
                        f"step={frame['step']} agent={agent['id']} battery={b}"
                    )
        assert not bad, "Battery out of [0, 1]:\n" + "\n".join(bad[:5])

    def test_agent_types_are_valid(self, first_frame):
        for agent in first_frame["agents"]:
            assert agent["type"] in VALID_AGENT_TYPES, (
                f"Unknown agent type: '{agent['type']}' for agent '{agent['id']}'"
            )

    def test_agent_tasks_are_valid(self, frames):
        invalid = []
        for frame in frames:
            for agent in frame["agents"]:
                if agent["task"] not in VALID_AGENT_TASKS:
                    invalid.append(
                        f"step={frame['step']} agent={agent['id']} task={agent['task']}"
                    )
        assert not invalid, "Invalid tasks:\n" + "\n".join(invalid[:5])

    def test_agent_location_within_map(self, first_frame, scenario):
        map_cols, map_rows = scenario["map"]["size"]
        for agent in first_frame["agents"]:
            loc = agent.get("location", [0, 0])
            assert 0 <= loc[0] <= map_cols, (
                f"Agent {agent['id']} col={loc[0]} out of [0,{map_cols}]"
            )
            assert 0 <= loc[1] <= map_rows, (
                f"Agent {agent['id']} row={loc[1]} out of [0,{map_rows}]"
            )

    def test_has_uav_and_ugv(self, first_frame):
        types = {a["type"] for a in first_frame["agents"]}
        assert "drone" in types or "uav" in types, "No UAV in first frame"
        assert any(t in types for t in ("ground_rescue", "ground_clear", "ugv")), \
            "No UGV in first frame"

    def test_balloon_present(self, first_frame):
        types = {a["type"] for a in first_frame["agents"]}
        assert "balloon" in types, "Balloon-1 not found in first frame"


# ---------------------------------------------------------------------------
# ── Group 4: Victim data integrity ─────────────────────────────────────────
# ---------------------------------------------------------------------------

class TestVictimData:

    def test_victims_list_non_empty(self, first_frame):
        assert len(first_frame["victims"]) > 0

    def test_victim_has_required_fields(self, first_frame):
        for v in first_frame["victims"]:
            for key in ("id", "location", "hp", "hp_max", "survival_pct", "status"):
                assert key in v, f"Victim '{v.get('id','?')}' missing '{key}'"

    def test_victim_hp_non_negative(self, frames):
        bad = []
        for frame in frames:
            for v in frame["victims"]:
                if v["hp"] < 0:
                    bad.append(f"step={frame['step']} victim={v['id']} hp={v['hp']}")
        assert not bad, "Negative HP found:\n" + "\n".join(bad[:5])

    def test_victim_hp_not_exceed_max(self, frames):
        bad = []
        for frame in frames:
            for v in frame["victims"]:
                if v["hp"] > v["hp_max"] + 1:   # +1 float tolerance
                    bad.append(
                        f"step={frame['step']} victim={v['id']} "
                        f"hp={v['hp']} > hp_max={v['hp_max']}"
                    )
        assert not bad, "HP exceeds max:\n" + "\n".join(bad[:5])

    def test_victim_survival_pct_range(self, frames):
        bad = []
        for frame in frames:
            for v in frame["victims"]:
                if not (0.0 <= v["survival_pct"] <= 100.0):
                    bad.append(
                        f"step={frame['step']} victim={v['id']} "
                        f"survival_pct={v['survival_pct']}"
                    )
        assert not bad, "survival_pct out of [0, 100]:\n" + "\n".join(bad[:5])

    def test_victim_status_valid(self, frames):
        invalid = []
        for frame in frames:
            for v in frame["victims"]:
                if v["status"] not in VALID_VICTIM_STATUS:
                    invalid.append(
                        f"step={frame['step']} victim={v['id']} status={v['status']}"
                    )
        assert not invalid, "Invalid victim status:\n" + "\n".join(invalid[:5])

    def test_hp_decreases_for_trapped_victims(self, frames):
        """Trapped victims should lose HP over time (not gain)."""
        if len(frames) < 2:
            pytest.skip("Need at least 2 frames")
        # Check victim HP trend (allow +1 float rounding)
        victim_hp = {}
        for frame in frames:
            for v in frame["victims"]:
                if v["id"] not in victim_hp:
                    victim_hp[v["id"]] = []
                victim_hp[v["id"]].append((frame["step"], v["hp"], v["status"]))

        regressions = []
        for vid, history in victim_hp.items():
            for i in range(1, len(history)):
                step, hp, status = history[i]
                prev_step, prev_hp, prev_status = history[i - 1]
                if prev_status in ("trapped", "unknown") and status in ("trapped", "unknown"):
                    if hp > prev_hp + 2:
                        regressions.append(
                            f"{vid}: step {prev_step}->{step} hp {prev_hp}->{hp} (gained)"
                        )
        assert not regressions, "HP increased for trapped victim:\n" + "\n".join(regressions[:5])

    def test_rescued_victim_hp_stable(self, frames):
        """Once rescued, victim HP should not change."""
        victim_rescued_hp = {}
        violations = []
        for frame in frames:
            for v in frame["victims"]:
                vid = v["id"]
                if v["status"] == "rescued":
                    if vid not in victim_rescued_hp:
                        victim_rescued_hp[vid] = v["hp"]
                    elif abs(v["hp"] - victim_rescued_hp[vid]) > 5:
                        violations.append(
                            f"{vid}: step {frame['step']} hp changed after rescue "
                            f"({victim_rescued_hp[vid]} -> {v['hp']})"
                        )
        assert not violations, "Rescued victim HP changed:\n" + "\n".join(violations[:5])


# ---------------------------------------------------------------------------
# ── Group 5: Event integrity ────────────────────────────────────────────────
# ---------------------------------------------------------------------------

class TestEvents:

    def test_event_has_type_and_description(self, frames):
        bad = []
        for frame in frames:
            for ev in frame["events"]:
                if "type" not in ev:
                    bad.append(f"step={frame['step']} event missing 'type': {ev}")
                if "description" not in ev:
                    bad.append(f"step={frame['step']} event missing 'description': {ev}")
        assert not bad, "\n".join(bad[:5])

    def test_event_agents_involved_is_list(self, frames):
        bad = []
        for frame in frames:
            for ev in frame["events"]:
                if "agents_involved" in ev and not isinstance(ev["agents_involved"], list):
                    bad.append(f"step={frame['step']} event agents_involved not list")
        assert not bad, "\n".join(bad[:5])

    def test_rescued_event_references_valid_victim(self, frames, scenario):
        valid_ids = {v["id"] for v in scenario["victims"]}
        bad = []
        for frame in frames:
            for ev in frame["events"]:
                if ev["type"] == "rescued":
                    desc = ev["description"]
                    referenced = [vid for vid in valid_ids if vid in desc]
                    if not referenced:
                        bad.append(f"step={frame['step']} rescued event has no valid victim ID: {desc}")
        assert not bad, "\n".join(bad[:5])

    def test_no_duplicate_rescued_events_for_same_victim(self, frames):
        rescued_steps: dict[str, int] = {}
        duplicates = []
        for frame in frames:
            for ev in frame["events"]:
                if ev["type"] == "rescued":
                    desc = ev["description"]
                    for word in desc.split():
                        if word.startswith("V") and len(word) <= 4:
                            if word in rescued_steps:
                                duplicates.append(
                                    f"{word} rescued at step {rescued_steps[word]} AND {frame['step']}"
                                )
                            else:
                                rescued_steps[word] = frame["step"]
        assert not duplicates, "Duplicate rescued events:\n" + "\n".join(duplicates)


# ---------------------------------------------------------------------------
# ── Group 6: Simulation outcome ─────────────────────────────────────────────
# ---------------------------------------------------------------------------

class TestSimulationOutcome:

    def test_rescued_count_non_decreasing(self, frames):
        prev = 0
        for frame in frames:
            curr = frame["stats"]["rescued"]
            assert curr >= prev, (
                f"Rescued count decreased at step {frame['step']}: {prev} -> {curr}"
            )
            prev = curr

    def test_sacrificed_count_non_decreasing(self, frames):
        prev = 0
        for frame in frames:
            curr = frame["stats"]["sacrificed"]
            assert curr >= prev, (
                f"Sacrificed count decreased at step {frame['step']}: {prev} -> {curr}"
            )
            prev = curr

    def test_active_agents_non_increasing(self, frames):
        prev = frames[0]["stats"]["active_agents"]
        for frame in frames[1:]:
            curr = frame["stats"]["active_agents"]
            assert curr <= prev, (
                f"Active agent count increased at step {frame['step']}: {prev} -> {curr}"
            )
            prev = curr

    def test_comm_coverage_pct_range(self, frames):
        for frame in frames:
            cov = frame["stats"]["comm_coverage_pct"]
            assert 0 <= cov <= 100, (
                f"step={frame['step']} comm_coverage_pct={cov} out of [0,100]"
            )

    def test_at_least_one_rescue_happens(self, last_frame):
        assert last_frame["stats"]["rescued"] >= 1, (
            "No rescues occurred in entire simulation"
        )

    def test_thinking_log_present_when_hub_exists(self, frames):
        hub_frames = [f for f in frames if f.get("hubs")]
        missing = [
            f["step"] for f in hub_frames
            if not f.get("thinking_log")
        ]
        # Allow up to 2 hub frames with empty thinking (formation step itself)
        assert len(missing) <= 2, (
            f"thinking_log empty in {len(missing)} hub frames: steps {missing[:5]}"
        )


# ---------------------------------------------------------------------------
# ── Group 7: Player.js data contract ───────────────────────────────────────
# ---------------------------------------------------------------------------

class TestPlayerDataContract:
    """
    Verify timeline.json conforms to what player.js expects.
    These tests mirror the assumptions hardcoded in player.js.
    """

    def test_agent_location_is_two_element_list(self, first_frame):
        for agent in first_frame["agents"]:
            loc = agent.get("location")
            assert isinstance(loc, list) and len(loc) == 2, (
                f"Agent {agent['id']} location should be [col, row], got {loc}"
            )

    def test_victim_location_is_two_element_list(self, first_frame):
        for v in first_frame["victims"]:
            loc = v.get("location")
            assert isinstance(loc, list) and len(loc) == 2, (
                f"Victim {v['id']} location should be [col, row], got {loc}"
            )

    def test_agent_battery_is_float_0_to_1(self, first_frame):
        for agent in first_frame["agents"]:
            b = agent["battery"]
            assert isinstance(b, (int, float)) and 0 <= b <= 1, (
                f"Agent {agent['id']} battery={b} should be 0.0~1.0"
            )

    def test_survival_pct_is_numeric(self, first_frame):
        for v in first_frame["victims"]:
            assert isinstance(v["survival_pct"], (int, float)), (
                f"Victim {v['id']} survival_pct should be numeric"
            )

    def test_stats_fields_are_numeric(self, first_frame):
        stats = first_frame["stats"]
        for key in ("rescued", "sacrificed", "active_agents", "comm_coverage_pct"):
            assert isinstance(stats[key], (int, float)), (
                f"stats.{key} should be numeric, got {type(stats[key])}"
            )

    def test_scenario_id_matches_scenario_file(self, timeline, scenario):
        assert timeline["scenario_id"] == scenario["scenario_id"], (
            f"timeline scenario_id='{timeline['scenario_id']}' != "
            f"scenario file id='{scenario['scenario_id']}'"
        )
