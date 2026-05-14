"""Road graph helpers for UGV movement over exported OSM road segments."""

from __future__ import annotations

import heapq
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

GridPoint = Tuple[float, float]


@dataclass(frozen=True)
class RouteState:
    target_key: str
    waypoints: Tuple[GridPoint, ...]


class RoadNetwork:
    def __init__(
        self,
        segments: Iterable[dict],
        map_size: Tuple[int, int] = (30, 30),
        road_tolerance_cells: float = 0.55,
    ):
        self.map_size = map_size
        self.road_tolerance_cells = road_tolerance_cells
        self.nodes: Dict[GridPoint, GridPoint] = {}
        self.graph: Dict[GridPoint, List[Tuple[GridPoint, float]]] = {}
        self.segments: List[Tuple[GridPoint, GridPoint]] = []

        for seg in segments:
            a_raw = seg.get("a", {})
            b_raw = seg.get("b", {})
            a = (float(a_raw["x"]), float(a_raw["y"]))
            b = (float(b_raw["x"]), float(b_raw["y"]))
            if a == b:
                continue
            self.segments.append((a, b))
        self._build_road_cell_graph()

    @classmethod
    def from_file(cls, path: Path) -> "RoadNetwork":
        data = json.loads(path.read_text(encoding="utf-8"))
        map_size = tuple(data.get("mapSize", [30, 30]))
        return cls(data.get("segments", []), map_size=(int(map_size[0]), int(map_size[1])))

    @property
    def available(self) -> bool:
        return bool(self.graph)

    def _build_road_cell_graph(self) -> None:
        cols, rows = self.map_size
        road_cells = set()
        for row in range(rows):
            for col in range(cols):
                point = (float(col), float(row))
                if any(
                    _dist_point_to_segment(point, a, b) <= self.road_tolerance_cells
                    for a, b in self.segments
                ):
                    road_cells.add(point)
                    self.nodes[point] = point

        neighbor_offsets = [(0, -1), (-1, 0), (1, 0), (0, 1)]
        for node in road_cells:
            x, y = node
            for dx, dy in neighbor_offsets:
                nxt = (x + dx, y + dy)
                if nxt not in road_cells:
                    continue
                self.graph.setdefault(node, []).append((nxt, math.sqrt(dx * dx + dy * dy)))

    def blocked_nodes(
        self,
        blocked_points: Optional[Iterable[GridPoint]] = None,
        radius_cells: float = 1.25,
    ) -> Set[GridPoint]:
        blocked: Set[GridPoint] = set()
        for point in blocked_points or []:
            for node in self.nodes:
                if _dist(node, point) <= radius_cells:
                    blocked.add(node)
        return blocked

    def nearest_node(
        self,
        point: GridPoint,
        blocked_nodes: Optional[Set[GridPoint]] = None,
    ) -> Optional[GridPoint]:
        if not self.nodes:
            return None
        blocked = blocked_nodes or set()
        candidates = [node for node in self.nodes if node not in blocked]
        if not candidates:
            return None
        return min(candidates, key=lambda node: _dist_sq(node, point))

    def nearest_road_point(self, point: GridPoint) -> Optional[GridPoint]:
        if not self.segments:
            return None

        best: Optional[GridPoint] = None
        best_dist = math.inf
        for a, b in self.segments:
            projected = _project_point_to_segment(point, a, b)
            dist = _dist_sq(point, projected)
            if dist < best_dist:
                best = projected
                best_dist = dist
        return best

    def shortest_path(
        self,
        start: GridPoint,
        goal: GridPoint,
        blocked_nodes: Optional[Set[GridPoint]] = None,
    ) -> List[GridPoint]:
        blocked = blocked_nodes or set()
        start_node = self.nearest_node(start, blocked)
        goal_node = self.nearest_node(goal, blocked)
        if start_node is None or goal_node is None:
            return []
        if start_node == goal_node:
            return [start_node]

        frontier: List[Tuple[float, GridPoint]] = [(0.0, start_node)]
        came_from: Dict[GridPoint, Optional[GridPoint]] = {start_node: None}
        cost_so_far: Dict[GridPoint, float] = {start_node: 0.0}

        while frontier:
            _, current = heapq.heappop(frontier)
            if current == goal_node:
                break

            for nxt, weight in self.graph.get(current, []):
                if nxt in blocked:
                    continue
                new_cost = cost_so_far[current] + weight
                if nxt not in cost_so_far or new_cost < cost_so_far[nxt]:
                    cost_so_far[nxt] = new_cost
                    priority = new_cost + _dist(nxt, goal_node)
                    heapq.heappush(frontier, (priority, nxt))
                    came_from[nxt] = current

        if goal_node not in came_from:
            return []

        path = [goal_node]
        current = goal_node
        while came_from[current] is not None:
            current = came_from[current]  # type: ignore[index]
            path.append(current)
        path.reverse()
        return path

    def route_step(
        self,
        current: GridPoint,
        target: GridPoint,
        speed_cells: float,
        target_key: str,
        cached: Optional[RouteState],
        blocked_points: Optional[Iterable[GridPoint]] = None,
    ) -> Tuple[GridPoint, RouteState]:
        blocked = self.blocked_nodes(blocked_points)
        target_road = self.nearest_node(target, blocked) or target
        current_road = self.nearest_node(current, blocked) or current

        cached_blocked = cached and any(point in blocked for point in cached.waypoints)
        if cached is None or cached.target_key != target_key or not cached.waypoints or cached_blocked:
            path = self.shortest_path(current_road, target_road, blocked)
            if not path:
                projected = self.nearest_road_point(current_road) or current_road
                return projected, RouteState(target_key=target_key, waypoints=())
            cached = RouteState(target_key=target_key, waypoints=tuple(path))

        waypoints = list(cached.waypoints)
        cur = current_road
        remaining = speed_cells

        while waypoints and remaining > 0:
            waypoint = waypoints[0]
            dist = _dist(cur, waypoint)
            if dist <= max(remaining, 1e-6):
                cur = waypoint
                remaining -= dist
                waypoints.pop(0)
                continue

            ratio = remaining / dist
            cur = (
                cur[0] + (waypoint[0] - cur[0]) * ratio,
                cur[1] + (waypoint[1] - cur[1]) * ratio,
            )
            remaining = 0

        projected = self.nearest_road_point(cur) or cur
        return projected, RouteState(target_key=target_key, waypoints=tuple(waypoints))


def _dist(a: GridPoint, b: GridPoint) -> float:
    return math.sqrt(_dist_sq(a, b))


def _dist_sq(a: GridPoint, b: GridPoint) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def _dist_point_to_segment(point: GridPoint, a: GridPoint, b: GridPoint) -> float:
    return _dist(point, _project_point_to_segment(point, a, b))


def _project_point_to_segment(point: GridPoint, a: GridPoint, b: GridPoint) -> GridPoint:
    px, py = point
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    len_sq = vx * vx + vy * vy
    if len_sq <= 0:
        return a
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / len_sq))
    return (ax + vx * t, ay + vy * t)
