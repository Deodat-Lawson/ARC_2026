/**
 * Urban-quake tactical grid: DEFAULT_3D map layers scaled from a 30×30 basis,
 * road cell coverage, ambient damage sampling, and planner-facing building rects.
 */

/** Continuous tactical grid indices → world xz (Urban: cell centres at half-integers). */
export function urbanGridToWorldXZ(ixc, iyc) {
  return { x: ixc + 0.5, z: iyc + 0.5 };
}

export function hash01(x, y, salt = 0) {
  return Math.abs(Math.sin((x + salt * 1.7) * 12.9898 + (y + salt * 0.7) * 78.233) * 43758.5) % 1;
}

export const DEFAULT_3D_TERRAIN = [
  { id: "T1", kind: "plaza", footprint: [1, 1, 4, 4] },
  { id: "T2", kind: "grass", footprint: [3, 18, 4, 3] },
  { id: "T3", kind: "grass", footprint: [24, 2, 4, 3] },
  { id: "T4", kind: "water", footprint: [29, 0, 1, 30] },
  { id: "T5", kind: "rubble", footprint: [16, 3, 4, 4] },
  { id: "T6", kind: "rubble", footprint: [14, 17, 4, 3] },
];

export const DEFAULT_3D_ROADS = [
  { id: "RH-2", kind: "main", points: [[0, 2], [29, 2]] },
  { id: "RH-8", kind: "main", points: [[0, 8], [29, 8]] },
  { id: "RH-12", kind: "side", points: [[0, 12], [29, 12]] },
  { id: "RH-20", kind: "main", points: [[0, 20], [29, 20]] },
  { id: "RH-28", kind: "side", points: [[0, 28], [29, 28]] },
  { id: "RV-2", kind: "main", points: [[2, 0], [2, 29]] },
  { id: "RV-7", kind: "side", points: [[7, 0], [7, 29]] },
  { id: "RV-12", kind: "main", points: [[12, 0], [12, 29]] },
  { id: "RV-21", kind: "main", points: [[21, 0], [21, 29]] },
  { id: "RV-28", kind: "side", points: [[28, 0], [28, 29]] },
];

export const DEFAULT_3D_BUILDINGS = [
  { id: "B1", footprint: [5, 5, 2, 3], kind: "apartment" },
  { id: "B2", footprint: [8, 4, 3, 2], kind: "civic" },
  { id: "B3", footprint: [13, 3, 2, 3], kind: "apartment" },
  { id: "B4", footprint: [15, 4, 3, 3], kind: "civic" },
  { id: "B5", footprint: [22, 5, 3, 2], kind: "lowrise" },
  { id: "B6", footprint: [24, 9, 2, 3], kind: "apartment" },
  { id: "B7", footprint: [6, 10, 3, 2], kind: "lowrise" },
  { id: "B8", footprint: [10, 9, 2, 3], kind: "apartment" },
  { id: "B9", footprint: [14, 10, 3, 2], kind: "civic" },
  { id: "B10", footprint: [18, 11, 3, 3], kind: "civic" },
  { id: "B11", footprint: [22, 13, 3, 3], kind: "warehouse" },
  { id: "B12", footprint: [3, 14, 3, 2], kind: "apartment" },
  { id: "B13", footprint: [8, 15, 2, 3], kind: "lowrise" },
  { id: "B14", footprint: [11, 16, 3, 2], kind: "lowrise" },
  { id: "B15", footprint: [15, 15, 3, 2], kind: "civic" },
  { id: "B16", footprint: [19, 16, 4, 4], kind: "warehouse" },
  { id: "B17", footprint: [25, 17, 2, 3], kind: "lowrise" },
  { id: "B18", footprint: [5, 21, 3, 3], kind: "civic" },
  { id: "B19", footprint: [10, 21, 3, 2], kind: "apartment" },
  { id: "B20", footprint: [14, 22, 3, 3], kind: "civic" },
  { id: "B21", footprint: [19, 22, 4, 3], kind: "warehouse" },
  { id: "B22", footprint: [25, 22, 3, 3], kind: "apartment" },
  { id: "B23", footprint: [3, 25, 3, 3], kind: "lowrise" },
  { id: "B24", footprint: [15, 26, 4, 2], kind: "warehouse" },
  { id: "B25", footprint: [21, 26, 3, 3], kind: "civic" },
];

export function scale3DFootprint([x, y, w, h], scenario) {
  const [cols, rows] = scenario.map.size || [30, 30];
  const sx = cols / 30;
  const sy = rows / 30;
  const nx = Math.max(0, Math.min(cols - 1, Math.round(x * sx)));
  const ny = Math.max(0, Math.min(rows - 1, Math.round(y * sy)));
  const nw = Math.max(1, Math.min(cols - nx, Math.round(w * sx)));
  const nh = Math.max(1, Math.min(rows - ny, Math.round(h * sy)));
  return [nx, ny, nw, nh];
}

export function get3DTerrain(scenario) {
  return (scenario?.map?.terrain?.length ? scenario.map.terrain : DEFAULT_3D_TERRAIN)
    .map((t) => ({ ...t, footprint: scale3DFootprint(t.footprint, scenario) }));
}

export function get3DRoads(scenario) {
  const [cols, rows] = scenario.map.size || [30, 30];
  const sx = cols / 30;
  const sy = rows / 30;
  return (scenario?.map?.roads?.length ? scenario.map.roads : DEFAULT_3D_ROADS).map((r) => ({
    ...r,
    points: (r.points || []).map(([x, y]) => [
      Math.max(0, Math.min(cols - 1, Math.round(x * sx))),
      Math.max(0, Math.min(rows - 1, Math.round(y * sy))),
    ]),
  }));
}

export function get3DBuildings(scenario) {
  return (scenario?.map?.buildings?.length ? scenario.map.buildings : DEFAULT_3D_BUILDINGS)
    .map((b) => ({ ...b, footprint: scale3DFootprint(b.footprint, scenario) }));
}

export function computeRoadCells(scenario) {
  const cells = new Set();
  const roads = get3DRoads(scenario);
  for (const road of roads) {
    const pts = road.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let s = 0; s <= steps; s += 1) {
        const t = steps === 0 ? 0 : s / steps;
        const cx = Math.round(a[0] + dx * t);
        const cy = Math.round(a[1] + dy * t);
        cells.add(`${cx},${cy}`);
      }
    }
  }
  return cells;
}

export function cellDamageLevel(cellX, cellY, riskZones) {
  if (!riskZones) return 0;
  let max = 0;
  for (const z of riskZones) {
    const dx = cellX - z.center[0];
    const dy = cellY - z.center[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= z.radius) {
      const inner = 1 - d / Math.max(0.01, z.radius);
      max = Math.max(max, 0.5 + inner * 0.5);
    } else if (d <= z.radius + 2) {
      const fade = 1 - (d - z.radius) / 2;
      max = Math.max(max, fade * 0.3);
    }
  }
  return Math.min(1, max);
}

export function buildingProfile(kind) {
  const profiles = {
    apartment: { color: 0x677382, roof: 0x222a32, minH: 3.2, maxH: 5.8, floors: 8 },
    civic: { color: 0x7d786c, roof: 0x252a2e, minH: 2.4, maxH: 4.4, floors: 6 },
    warehouse: { color: 0x5c6470, roof: 0x30343a, minH: 1.6, maxH: 2.6, floors: 3 },
    lowrise: { color: 0x766b5f, roof: 0x2b2927, minH: 2.0, maxH: 3.4, floors: 4 },
  };
  return profiles[kind] || profiles.lowrise;
}

export function buildingRenderFootprint(x, y, w, d, height) {
  const cx = x + w / 2;
  const cz = y + d / 2;
  const heightSpan = height > 4.5 ? 1.55 : height > 3.1 ? 1.32 : 1.05;
  const targetW = Math.min(w + 0.34, Math.max(w * 0.96, heightSpan));
  const targetD = Math.min(d + 0.34, Math.max(d * 0.96, heightSpan));
  return [cx - targetW / 2, cz - targetD / 2, targetW, targetD];
}

export function scenarioBuildingEntries(scenario) {
  const explicit = get3DBuildings(scenario).map((b) => ({ ...b, synthetic: false }));
  const [cols, rows] = scenario.map.size;
  const occupied = new Set();
  const markRect = (x, y, w = 1, h = 1, pad = 0) => {
    for (let dx = -pad; dx < w + pad; dx += 1) {
      for (let dy = -pad; dy < h + pad; dy += 1) {
        occupied.add(`${x + dx},${y + dy}`);
      }
    }
  };

  const roadCells = computeRoadCells(scenario);
  for (const key of roadCells) occupied.add(key);
  if (scenario.map.base) markRect(scenario.map.base[0], scenario.map.base[1], 1, 1, 2);
  for (const v of scenario.victims || []) markRect(v.location[0], v.location[1], 1, 1, 1);
  for (const b of scenario.map.blocked_cells || []) markRect(b.location[0], b.location[1], 1, 1, 1);
  for (const t of get3DTerrain(scenario)) {
    if (t.kind === "water" || t.kind === "grass" || t.kind === "plaza") {
      const [x, y, w, h] = t.footprint;
      markRect(x, y, w, h, 0);
    }
  }
  for (const b of explicit) {
    const [x, y, w, h] = b.footprint;
    markRect(x, y, w, h, 1);
  }

  const infill = [];
  const target = Math.min(36, Math.max(10, Math.floor((cols * rows) / 42)));
  for (let y = 1; y < rows - 1 && infill.length < target; y += 1) {
    for (let x = 1; x < cols - 1 && infill.length < target; x += 1) {
      if (occupied.has(`${x},${y}`)) continue;
      const r = hash01(x, y, 210);
      if (r > 0.2) continue;
      const wider = x < cols - 2 && !occupied.has(`${x + 1},${y}`) && hash01(x, y, 211) > 0.58;
      const deeper = y < rows - 2 && !occupied.has(`${x},${y + 1}`) && !wider && hash01(x, y, 212) > 0.62;
      const w = wider ? 2 : 1;
      const h = deeper ? 2 : 1;
      if (wider && occupied.has(`${x + 1},${y}`)) continue;
      if (deeper && occupied.has(`${x},${y + 1}`)) continue;
      const kindRoll = hash01(x, y, 213);
      const kind = kindRoll < 0.34 ? "lowrise" : kindRoll < 0.62 ? "apartment" : kindRoll < 0.82 ? "civic" : "warehouse";
      infill.push({
        id: `INF-${x}-${y}`,
        kind,
        footprint: [x, y, w, h],
        synthetic: true,
      });
      markRect(x, y, w, h, 1);
    }
  }

  return explicit.concat(infill);
}

export function buildingAvoidanceRects(scenario) {
  return scenarioBuildingEntries(scenario).map((b) => {
    const [x, y, w, d] = b.footprint;
    const profile = buildingProfile(b.kind);
    const h = profile.minH + hash01(x, y, 130) * (profile.maxH - profile.minH);
    const [rx, rz, rw, rd] = buildingRenderFootprint(x, y, w, d, h);
    return { x: rx, z: rz, w: rw, d: rd };
  });
}
