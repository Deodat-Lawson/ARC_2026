/**
 * Road graph for UGV movement — ported from lite_sim/road_network.py
 * (OSM road segments → grid corridor graph → A* + route_step).
 */

function distSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function dist(a, b) {
  return Math.sqrt(distSq(a, b));
}

function projectPointToSegment(point, a, b) {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 0) return [ax, ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  return [ax + vx * t, ay + vy * t];
}

function distPointToSegment(point, a, b) {
  return dist(point, projectPointToSegment(point, a, b));
}

export class TacticalRoadNetwork {
  /**
   * @param {Array<{a: {x:number,y:number}, b: {x:number,y:number}}>} segments
   * @param {[number, number]} mapSize [cols, rows]
   * @param {number} roadToleranceCells
   */
  constructor(segments, mapSize = [30, 30], roadToleranceCells = 0.55) {
    this.mapSize = mapSize;
    this.roadToleranceCells = roadToleranceCells;
    /** @type {Map<string, [number, number]>} */
    this.nodes = new Map();
    /** @type {Map<string, Array<[string, number]>>} adjacency key → [[neighborKey, weight], ...] */
    this.graph = new Map();
    /** @type {Array<[[number,number],[number,number]]>} */
    this.segments = [];

    for (const seg of segments) {
      const aRaw = seg.a || {};
      const bRaw = seg.b || {};
      const a = [Number(aRaw.x), Number(aRaw.y)];
      const b = [Number(bRaw.x), Number(bRaw.y)];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      this.segments.push([a, b]);
    }
    this._buildRoadCellGraph();
  }

  /**
   * @param {object} data JSON like firenze_300m_roads.json
   */
  static fromExportData(data) {
    const ms = data.mapSize || [30, 30];
    const mapSize = [Math.max(1, Math.floor(ms[0])), Math.max(1, Math.floor(ms[1]))];
    return new TacticalRoadNetwork(data.segments || [], mapSize, 0.55);
  }

  get available() {
    return this.graph.size > 0;
  }

  _pointKey(p) {
    return `${p[0]},${p[1]}`;
  }

  _parseKey(k) {
    const [x, y] = k.split(",").map(Number);
    return [x, y];
  }

  _buildRoadCellGraph() {
    const [cols, rows] = this.mapSize;
    const tol = this.roadToleranceCells;
    /** @type {Set<string>} */
    const roadCells = new Set();

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const point = [col, row];
        const near = this.segments.some(([a, b]) => distPointToSegment(point, a, b) <= tol);
        if (near) {
          const key = this._pointKey(point);
          roadCells.add(key);
          this.nodes.set(key, point);
        }
      }
    }

    const offsets = [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ];
    for (const key of roadCells) {
      const [x, y] = this._parseKey(key);
      for (const [dx, dy] of offsets) {
        const nxt = [x + dx, y + dy];
        const nKey = this._pointKey(nxt);
        if (!roadCells.has(nKey)) continue;
        const w = Math.sqrt(dx * dx + dy * dy);
        if (!this.graph.has(key)) this.graph.set(key, []);
        this.graph.get(key).push([nKey, w]);
      }
    }
  }

  /**
   * @param {Iterable<[number, number]>|null|undefined} blockedPoints
   * @param {number} radiusCells
   * @returns {Set<string>}
   */
  blockedNodes(blockedPoints, radiusCells = 1.25) {
    const blocked = new Set();
    const pts = blockedPoints ? [...blockedPoints] : [];
    for (const [, node] of this.nodes) {
      for (const p of pts) {
        if (dist(node, p) <= radiusCells) blocked.add(this._pointKey(node));
      }
    }
    return blocked;
  }

  /**
   * @param {[number, number]} point
   * @param {Set<string>|null} blockedKeys
   */
  nearestNode(point, blockedKeys) {
    if (this.nodes.size === 0) return null;
    const blocked = blockedKeys || new Set();
    let best = null;
    let bestSq = Infinity;
    for (const [, node] of this.nodes) {
      const k = this._pointKey(node);
      if (blocked.has(k)) continue;
      const d = distSq(node, point);
      if (d < bestSq) {
        bestSq = d;
        best = node;
      }
    }
    return best;
  }

  nearestRoadPoint(point) {
    if (this.segments.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const [a, b] of this.segments) {
      const proj = projectPointToSegment(point, a, b);
      const d = distSq(point, proj);
      if (d < bestDist) {
        bestDist = d;
        best = proj;
      }
    }
    return best;
  }

  /**
   * A* shortest path on road grid graph (matches lite_sim).
   */
  shortestPath(start, goal, blockedKeys) {
    const blocked = blockedKeys || new Set();
    const startNode = this.nearestNode(start, blocked);
    const goalNode = this.nearestNode(goal, blocked);
    if (!startNode || !goalNode) return [];
    const startK = this._pointKey(startNode);
    const goalK = this._pointKey(goalNode);
    if (startK === goalK) return [startNode];

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
      const edges = this.graph.get(currentK) || [];
      for (const [nKey, weight] of edges) {
        if (blocked.has(nKey)) continue;
        const prev = costSoFar.get(currentK) ?? Infinity;
        const newCost = prev + weight;
        const nCost = costSoFar.get(nKey);
        if (nCost === undefined || newCost < nCost) {
          costSoFar.set(nKey, newCost);
          const nPt = this._parseKey(nKey);
          const priority = newCost + dist(nPt, goalNode);
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
      path.push(this._parseKey(cur));
    }
    path.reverse();
    return path;
  }

  /**
   * @returns {[[number,number], { targetKey: string, waypoints: [number,number][] }]}
   */
  routeStep(current, target, speedCells, targetKey, cached, blockedPoints) {
    const blocked = this.blockedNodes(blockedPoints, 1.25);
    const targetRoad = this.nearestNode(target, blocked) || target;
    const currentRoad = this.nearestNode(current, blocked) || current;

    const cachedBlocked =
      cached &&
      cached.waypoints &&
      cached.waypoints.some((pt) => blocked.has(this._pointKey(pt)));

    let waypoints;
    if (cached == null || cached.targetKey !== targetKey || !cached.waypoints?.length || cachedBlocked) {
      const path = this.shortestPath(currentRoad, targetRoad, blocked);
      if (!path.length) {
        const projected = this.nearestRoadPoint(currentRoad) || currentRoad;
        return [projected, { targetKey, waypoints: [] }];
      }
      waypoints = [...path];
    } else {
      waypoints = [...cached.waypoints];
    }

    let cur = [...currentRoad];
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

    const projected = this.nearestRoadPoint(cur) || cur;
    return [projected, { targetKey, waypoints }];
  }
}
