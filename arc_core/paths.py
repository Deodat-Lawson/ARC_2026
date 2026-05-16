"""
Repository layout helpers.

All runnable code lives under ``arc_core``; inputs/outputs that must sit next
to the Next.js demo or sibling folders still resolve via ``REPO_ROOT``.
"""

from pathlib import Path

# arc_core/paths.py → arc_core/
ARC_CORE_ROOT: Path = Path(__file__).resolve().parent
# ARC_2026 repository root (parent of arc_core)
REPO_ROOT: Path = ARC_CORE_ROOT.parent

# Demo / scenario artifacts shipped with the package
SIMULATION_DATA_DIR: Path = ARC_CORE_ROOT / "simulation" / "data"
DEMO_PLAYER_DIR: Path = REPO_ROOT / "demo_player"
ARC_LITE_DEMO_DIR: Path = REPO_ROOT / "ARC_2026-arc-lite-2d-demo"

DEFAULT_SCENARIO_PATH: Path = SIMULATION_DATA_DIR / "scenario_001.json"
DEFAULT_TIMELINE_PATH: Path = DEMO_PLAYER_DIR / "timeline.json"
