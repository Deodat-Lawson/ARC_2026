/**
 * Scene-specific planners: wildfire (occupancy-grid A* + APF fallback), industrial (occupancy-grid A* + route_step).
 * Urban ground routing stays on {@link TacticalRoadNetwork} in app.js.
 */

import { pointNearBuilding } from "./collision.js";
import { roundCoord } from "./math.js";
import { avoidBuildingStep, markDroneOverflight } from "./motion-avoid.js";

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function pointKey(p) {
  return `${p[0]},${p[1]}`;
}

function parseKey(k) {
  const [x, y] = k.split(",").map(Number);
  return [x, y];
}

/** @param {(state: object) => unknown[]} getBuildingRects */
function occupancyBlockedKeys(state, getBuildingRects) {
  const rects = getBuildingRects(state);
  const blocked = new Set();
  const cols = Math.max(1, Math.floor(state.map.size[0]));
  const rows = Math.max(1, Math.floor(state.map.size[1]));
  const pts = (state.map.blocked_cells || [])
    .filter((b) => b.status === "blocked")
    .map((b) => b.location);
  for (let iy = 0; iy < rows; iy += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      if (pointNearBuilding(ix, iy, rects, 0.42)) {
        blocked.add(pointKey([ix, iy]));
        continue;
      }
      for (const p of pts) {
        if (Math.hypot(ix - p[0], iy - p[1]) <= 1.25) {
          blocked.add(pointKey([ix, iy]));
          break;
        }
      }
    }
  }
  return blocked;
}

/**
 * @param {[number,number]} point
 * @param {Set<string>} blockedKeys
 * @param {[number,number]} mapSize [cols, rows]
 */
function nearestFreeCellToPoint(point, blockedKeys, mapSize) {
  const cols = Math.max(1, Math.floor(mapSize[0]));
  const rows = Math.max(1, Math.floor(mapSize[1]));
  let best = null;
  let bestSq = Infinity;
  for (let iy = 0; iy < rows; iy += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const k = pointKey([ix, iy]);
      if (blockedKeys.has(k)) continue;
      const d = (ix - point[0]) ** 2 + (iy - point[1]) ** 2;
      if (d < bestSq) {
        bestSq = d;
        best = [ix, iy];
      }
    }
  }
  return best;
}

/**
 * A* on 8-connected uniform grid; nodes are integer cell centers.
 * @param {[number,number]} start
 * @param {[number,number]} goal
 * @param {Set<string>} blockedKeys
 * @param {[number,number]} mapSize
 */
function gridShortestPath(start, goal, blockedKeys, mapSize) {
  const cols = Math.max(1, Math.floor(mapSize[0]));
  const rows = Math.max(1, Math.floor(mapSize[1]));
  const startNode = nearestFreeCellToPoint(start, blockedKeys, mapSize);
  const goalNode = nearestFreeCellToPoint(goal, blockedKeys, mapSize);
  if (!startNode || !goalNode) return [];

  const startK = pointKey(startNode);
  const goalK = pointKey(goalNode);
  if (startK === goalK) return [startNode];

  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  /** @type {Array<[number, string]>} */
  const frontier = [[0, startK]];
  const cameFrom = new Map([[startK, null]]);
  const costSoFar = new Map([[startK, 0]]);

  while (frontier.length > 0) {
    let minI = 0;
    for (let i = 1; i < frontier.length; i += 1) {
      if (frontier[i][0] < frontier[minI][0]) minI = i;
    }
    const [, currentK] = frontier.splice(minI, 1)[0];
    if (currentK === goalK) break;

    const [cx, cy] = parseKey(currentK);
    const edges = [];
    for (const [dx, dy] of offsets) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx > cols - 1 || ny > rows - 1) continue;
      const nk = pointKey([nx, ny]);
      if (blockedKeys.has(nk)) continue;
      const w = Math.hypot(dx, dy);
      edges.push([nk, w]);
    }

    for (const [nKey, weight] of edges) {
      const prev = costSoFar.get(currentK) ?? Infinity;
      const newCost = prev + weight;
      const nCost = costSoFar.get(nKey);
      if (nCost === undefined || newCost < nCost) {
        costSoFar.set(nKey, newCost);
        const [gx, gy] = parseKey(nKey);
        const priority = newCost + Math.hypot(gx - goalNode[0], gy - goalNode[1]);
        frontier.push([priority, nKey]);
        cameFrom.set(nKey, currentK);
      }
    }
  }

  if (!cameFrom.has(goalK)) return [];

  const path = [goalNode];
  let cur = goalK;
  while (cameFrom.get(cur) != null) {
    cur = cameFrom.get(cur);
    path.push(parseKey(cur));
  }
  path.reverse();
  return path;
}

/**
 * Industrial-style occupancy grid step (same contract as {@link TacticalRoadNetwork#routeStep}).
 * @returns {[[number,number], { targetKey: string, waypoints: [number,number][] }]}
 */
export function occupancyGridRouteStep(current, target, speedCells, targetKey, cached, state, getBuildingRects) {
  const blockedKeys = occupancyBlockedKeys(state, getBuildingRects);

  const cachedBlocked =
    cached &&
    cached.waypoints &&
    cached.waypoints.some((pt) => blockedKeys.has(pointKey([Math.round(pt[0]), Math.round(pt[1])])));

  const goalApprox = [target[0], target[1]];
  const currentApprox = [current[0], current[1]];
  const mapSize = state.map.size;

  let waypoints;
  if (cached == null || cached.targetKey !== targetKey || !cached.waypoints?.length || cachedBlocked) {
    const path = gridShortestPath(currentApprox, goalApprox, blockedKeys, mapSize);
    if (!path.length) {
      return [[current[0], current[1]], { targetKey, waypoints: [] }];
    }
    waypoints = [...path];
  } else {
    waypoints = [...cached.waypoints];
  }

  let cur = [...currentApprox];
  let remaining = speedCells;

  while (waypoints.length > 0 && remaining > 0) {
    const waypoint = waypoints[0];
    const d = dist(cur, waypoint);
    if (d <= Math.max(remaining, 1e-6)) {
      cur = [...waypoint];
      remaining -= d;
      waypoints.shift();
      continue;
    }
    const ratio = remaining / d;
    cur = [cur[0] + (waypoint[0] - cur[0]) * ratio, cur[1] + (waypoint[1] - cur[1]) * ratio];
    remaining = 0;
  }

  return [cur, { targetKey, waypoints }];
}

function clampToMap(pos, state) {
  const cols = state.map.size[0];
  const rows = state.map.size[1];
  return [
    Math.max(0, Math.min(cols - 1, pos[0])),
    Math.max(0, Math.min(rows - 1, pos[1])),
  ];
}

function closestPointOnRect(px, py, r) {
  const cx = Math.max(r.x, Math.min(r.x + r.w, px));
  const cz = Math.max(r.z, Math.min(r.z + r.d, py));
  return [cx, cz];
}

function repulseFromPoint(px, py, ox, oy, eta, rho0) {
  let dx = px - ox;
  let dy = py - oy;
  let rho = Math.hypot(dx, dy);
  const rhoMin = 0.12;
  if (rho < rhoMin) {
    rho = rhoMin;
    dx = rhoMin;
    dy = 0;
  }
  if (rho >= rho0) return [0, 0];
  const mag = eta * (1 / rho - 1 / rho0) / (rho * rho);
  return [(dx / rho) * mag, (dy / rho) * mag];
}

function clearWildfireApfMemory(agent) {
  agent._wfApfHist = [];
  agent._wfApfSx = null;
  agent._wfApfSy = null;
  agent._wfApfBypassUntil = 0;
}

/** RMS distance of samples from their centroid (detect hover / flip-flop). */
function positionScatterSq(ring) {
  if (ring.length < 8) return Infinity;
  let mx = 0;
  let my = 0;
  for (const p of ring) {
    mx += p[0];
    my += p[1];
  }
  mx /= ring.length;
  my /= ring.length;
  let acc = 0;
  for (const p of ring) {
    const dx = p[0] - mx;
    const dy = p[1] - my;
    acc += dx * dx + dy * dy;
  }
  return acc / ring.length;
}

const WF_APf_HISTORY = 14;
/** Below this scatter² (≈ tight orbit / oscillation), trigger escape bias. */
const WF_APf_STUCK_SCATTER_SQ = 0.55;
const WF_APf_BYPASS_TICKS = 22;
const WF_APf_FORCE_BLEND = 0.26;
const WF_ROUTE_REPLAN_TICKS = 8;
const WF_ROUTE_NO_PROGRESS_EPS = 0.08;
const WF_ROUTE_NO_PROGRESS_LIMIT = 5;

/**
 * Wildfire global route: A* around inflated burn rects, with APF only as a fallback.
 * @param {(state: object) => unknown[]} getBuildingRects
 */
export function moveWildfireRoutedToward(agent, target, state, getBuildingRects, targetKey = "wildfire-target") {
  if (!target || !state?.map) return;
  const pos = agent.location;
  const speed = agent.speed || 1;
  const distToGoal = dist(pos, target);
  if (distToGoal < 0.05) return;

  if (agent._wfTargetKey !== targetKey) {
    agent._wfTargetKey = targetKey;
    agent._wfRoute = null;
    clearWildfireApfMemory(agent);
  }

  const blockedKeys = occupancyBlockedKeys(state, getBuildingRects);
  const route = agent._wfRoute || {};
  const cachedBlocked =
    Array.isArray(route.waypoints) &&
    route.waypoints.some((pt) => blockedKeys.has(pointKey([Math.round(pt[0]), Math.round(pt[1])])));
  const stale = (state.timestep ?? 0) - (route.plannedAt ?? -Infinity) >= WF_ROUTE_REPLAN_TICKS;
  const noProgress = route.noProgressTicks >= WF_ROUTE_NO_PROGRESS_LIMIT;

  let waypoints = Array.isArray(route.waypoints) ? [...route.waypoints] : [];
  if (route.targetKey !== targetKey || !waypoints.length || cachedBlocked || stale || noProgress) {
    waypoints = gridShortestPath(pos, target, blockedKeys, state.map.size);
    agent._wfRoute = {
      targetKey,
      waypoints: [...waypoints],
      plannedAt: state.timestep ?? 0,
      lastWaypointKey: null,
      lastWaypointDist: Infinity,
      noProgressTicks: 0,
    };
    clearWildfireApfMemory(agent);
  }

  while (waypoints.length && dist(pos, waypoints[0]) < 0.12) waypoints.shift();
  if (!waypoints.length) {
    agent._wfRoute = { ...agent._wfRoute, waypoints };
    moveWildfireApfToward(agent, target, state, getBuildingRects, targetKey);
    return;
  }

  const waypoint = waypoints[0];
  const legDx = waypoint[0] - pos[0];
  const legDy = waypoint[1] - pos[1];
  const legDist = Math.hypot(legDx, legDy);
  if (legDist < 1e-5) return;

  const stepLen = Math.min(speed, legDist);
  let next = [
    roundCoord(pos[0] + (legDx / legDist) * stepLen),
    roundCoord(pos[1] + (legDy / legDist) * stepLen),
  ];
  next = clampToMap(next, state);
  next = avoidBuildingStep(pos, next, waypoint, speed, state, getBuildingRects);

  const moved = dist(pos, next);
  const waypointKey = pointKey(waypoint);
  const nextWaypointDist = dist(next, waypoint);
  const sameWaypoint = agent._wfRoute?.lastWaypointKey === waypointKey;
  const prevWaypointDist = agent._wfRoute?.lastWaypointDist ?? Infinity;
  const noProgressTicks =
    moved < 0.03 || (sameWaypoint && nextWaypointDist > prevWaypointDist - WF_ROUTE_NO_PROGRESS_EPS)
      ? (agent._wfRoute?.noProgressTicks ?? 0) + 1
      : 0;

  agent._wfRoute = {
    targetKey,
    waypoints,
    plannedAt: agent._wfRoute?.plannedAt ?? (state.timestep ?? 0),
    lastWaypointKey: waypointKey,
    lastWaypointDist: nextWaypointDist,
    noProgressTicks,
  };

  if (noProgressTicks >= WF_ROUTE_NO_PROGRESS_LIMIT) {
    agent._wfRoute = null;
    moveWildfireApfToward(agent, target, state, getBuildingRects, targetKey);
    return;
  }

  markDroneOverflight(agent, pos, next, state, getBuildingRects);
  agent.location = next;
}

/**
 * Artificial potential field: attract to target, repel from burn rects and (non-duplicate) risk discs.
 * Smoothing + stuck detection reduces saddle-point oscillation seen with drones between fire patches.
 * @param {(state: object) => unknown[]} getBuildingRects
 */
export function moveWildfireApfToward(agent, target, state, getBuildingRects, targetKey = "wildfire-target") {
  if (!target || !state?.map) return;
  if (agent._wfApfTargetKey !== targetKey) {
    agent._wfApfTargetKey = targetKey;
    clearWildfireApfMemory(agent);
  }
  const pos = agent.location;
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const distToGoal = Math.hypot(dx, dy);
  if (distToGoal < 0.05) return;

  const speed = agent.speed || 1;
  const tNow = state.timestep ?? 0;

  /** @type {number[]} */
  let hist = agent._wfApfHist;
  if (!hist || !Array.isArray(hist)) hist = [];
  hist.push([pos[0], pos[1]]);
  while (hist.length > WF_APf_HISTORY) hist.shift();
  agent._wfApfHist = hist;

  const scatterSq = positionScatterSq(hist);
  let bypassUntil = agent._wfApfBypassUntil ?? 0;
  if (scatterSq < WF_APf_STUCK_SCATTER_SQ && distToGoal > 0.75 && hist.length >= WF_APf_HISTORY) {
    bypassUntil = Math.max(bypassUntil, tNow + WF_APf_BYPASS_TICKS);
  }
  agent._wfApfBypassUntil = bypassUntil;
  const bypass = tNow < bypassUntil;

  const kAtt = bypass ? 3.6 : 2.2;
  let fx = (dx / distToGoal) * kAtt;
  let fy = (dy / distToGoal) * kAtt;

  const rects = getBuildingRects(state);
  const etaRect = bypass ? 4.5 : 14;
  const rho0Rect = bypass ? 3.8 : 5.5;
  for (const r of rects) {
    const [qx, qy] = closestPointOnRect(pos[0], pos[1], r);
    const [rx, ry] = repulseFromPoint(pos[0], pos[1], qx, qy, etaRect, rho0Rect);
    fx += rx;
    fy += ry;
  }

  const zones = state.map.risk_zones || [];
  const etaFire = bypass ? 3 : 11;
  const rho0Fire = bypass ? 4 : 6;
  const skipFireDisks = rects.length > 0;
  for (const z of zones) {
    if (skipFireDisks && z.type === "fire") continue;
    if (!(z.type === "fire" || z.risk > 0.2)) continue;
    const [cx, cy] = z.center;
    const rad = z.radius || 1;
    const influence = rho0Fire + rad;
    const [rx, ry] = repulseFromPoint(pos[0], pos[1], cx, cy, etaFire * (0.5 + (z.risk || 0)), influence);
    fx += rx;
    fy += ry;
  }

  let sx = agent._wfApfSx;
  let sy = agent._wfApfSy;
  if (sx == null || sy == null) {
    sx = fx;
    sy = fy;
  } else {
    sx += WF_APf_FORCE_BLEND * (fx - sx);
    sy += WF_APf_FORCE_BLEND * (fy - sy);
  }

  let wx = sx;
  let wy = sy;
  const fmag = Math.hypot(wx, wy);
  if (fmag < 0.09 && distToGoal > 1.2) {
    wx += -(dy / distToGoal) * 0.55;
    wy += (dx / distToGoal) * 0.55;
  }

  const fmag2 = Math.hypot(wx, wy);
  if (fmag2 < 1e-5) return;

  agent._wfApfSx = wx;
  agent._wfApfSy = wy;

  const stepLen = Math.min(speed, distToGoal);
  const nx = pos[0] + (wx / fmag2) * stepLen;
  const ny = pos[1] + (wy / fmag2) * stepLen;
  let next = clampToMap([nx, ny], state);
  next = [roundCoord(next[0]), roundCoord(next[1])];
  next = avoidBuildingStep(agent.location, next, target, speed, state, getBuildingRects);

  const movedHx = next[0] - pos[0];
  const movedHy = next[1] - pos[1];
  const towardGoal = movedHx * dx + movedHy * dy;
  if (towardGoal < -0.08 * speed && distToGoal > 0.4) {
    const slip = avoidBuildingStep(
      agent.location,
      [roundCoord(pos[0] + (dx / distToGoal) * speed), roundCoord(pos[1] + (dy / distToGoal) * speed)],
      target,
      speed,
      state,
      getBuildingRects,
    );
    const slipToward = (slip[0] - pos[0]) * dx + (slip[1] - pos[1]) * dy;
    if (slipToward > towardGoal) next = slip;
  }

  markDroneOverflight(agent, pos, next, state, getBuildingRects);
  agent.location = next;
}
