/** Shared local obstacle avoidance (grid coords, building/burn rects). */

import { pointNearBuilding } from "./collision.js";
import { roundCoord } from "./math.js";

const DRONE_OBSTACLE_CLEARANCE_M = 2;

function isDrone(agent) {
  return String(agent?.type || "").toLowerCase() === "drone";
}

function lineIntersectsRect(a, b, r, margin = 0.04) {
  const minX = r.x - margin;
  const maxX = r.x + r.w + margin;
  const minY = r.z - margin;
  const maxY = r.z + r.d + margin;
  const x0 = a[0];
  const y0 = a[1];
  const dx = b[0] - x0;
  const dy = b[1] - y0;
  let t0 = 0;
  let t1 = 1;
  const clips = [
    [-dx, x0 - minX],
    [dx, maxX - x0],
    [-dy, y0 - minY],
    [dy, maxY - y0],
  ];
  for (const [p, q] of clips) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function rectOverflightAltitudeUnits(rect, state) {
  const cellSizeM = Math.max(1, Number(state?.map?.cell_size_m) || 10);
  const clearance = DRONE_OBSTACLE_CLEARANCE_M / cellSizeM;
  const obstacleHeight =
    Number(rect.heightUnits ?? rect.height ?? rect.h ?? rect.altitudeUnits ?? 1);
  return Math.max(0, obstacleHeight) + clearance;
}

export function markDroneOverflight(agent, from, to, state, getBuildingRects) {
  if (!isDrone(agent) || !state?.map || !Array.isArray(from) || !Array.isArray(to)) return;
  const rects = getBuildingRects?.(state) || [];
  let requiredAlt = 0;
  for (const r of rects) {
    if (!lineIntersectsRect(from, to, r)) continue;
    requiredAlt = Math.max(requiredAlt, rectOverflightAltitudeUnits(r, state));
  }
  const tNow = state.timestep ?? 0;
  if (requiredAlt > 0) {
    agent._overflightAltitudeUnits = requiredAlt;
    agent._overflightUntil = tNow + 2;
  } else if ((agent._overflightUntil ?? 0) < tNow) {
    agent._overflightAltitudeUnits = 0;
  }
}

export function avoidBuildingStep(from, proposed, target, speed, state, getBuildingRects) {
  if (!state?.map) return proposed;
  const rects = getBuildingRects(state);
  if (!pointNearBuilding(proposed[0], proposed[1], rects, 0.36)) return proposed;
  const [x, y] = from;
  const candidates = [
    [x + speed, y],
    [x - speed, y],
    [x, y + speed],
    [x, y - speed],
    [x + speed * 0.7, y + speed * 0.7],
    [x + speed * 0.7, y - speed * 0.7],
    [x - speed * 0.7, y + speed * 0.7],
    [x - speed * 0.7, y - speed * 0.7],
  ]
    .map(([cx, cy]) => [roundCoord(cx), roundCoord(cy)])
    .filter(([cx, cy]) => {
      const [cols, rows] = state.map.size;
      return (
        cx >= 0 &&
        cy >= 0 &&
        cx <= cols - 1 &&
        cy <= rows - 1 &&
        !pointNearBuilding(cx, cy, rects, 0.36)
      );
    });
  if (!candidates.length) return from;
  candidates.sort((a, b) => {
    const da = Math.hypot(a[0] - target[0], a[1] - target[1]);
    const db = Math.hypot(b[0] - target[0], b[1] - target[1]);
    return da - db;
  });
  return candidates[0];
}
