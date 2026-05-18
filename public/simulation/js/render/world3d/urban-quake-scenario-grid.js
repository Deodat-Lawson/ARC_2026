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

/** Fixed, hand-verified building layout. No procedural infill, no runtime dedup.
 *  Cell ranges avoid roads, base, victims, blocked cells, and terrain patches. */
export const DEFAULT_3D_BUILDINGS = [
  { id: "B1", footprint: [5, 5, 2, 3], kind: "apartment" },
  { id: "B3", footprint: [13, 3, 2, 3], kind: "apartment" },
  { id: "B5", footprint: [22, 5, 3, 2], kind: "lowrise" },
  { id: "B6", footprint: [24, 9, 2, 3], kind: "apartment" },
  { id: "B7", footprint: [8, 10, 3, 2], kind: "lowrise" },
  { id: "B9", footprint: [14, 10, 3, 2], kind: "civic" },
  { id: "B12", footprint: [3, 14, 3, 2], kind: "apartment" },
  { id: "B13", footprint: [8, 15, 2, 3], kind: "lowrise" },
  { id: "B15", footprint: [15, 15, 3, 2], kind: "civic" },
  { id: "B17", footprint: [25, 17, 2, 3], kind: "lowrise" },
  { id: "B18", footprint: [4, 21, 3, 3], kind: "civic" },
  { id: "B19", footprint: [8, 21, 4, 2], kind: "apartment" },
  { id: "B21", footprint: [13, 22, 4, 3], kind: "warehouse" },
  { id: "B22", footprint: [25, 22, 3, 3], kind: "apartment" },
  { id: "B26", footprint: [5, 1, 1, 1], kind: "lowrise" },
  { id: "B27", footprint: [8, 1, 1, 1], kind: "warehouse" },
  { id: "B28", footprint: [19, 1, 1, 1], kind: "lowrise" },
  { id: "B29", footprint: [26, 1, 1, 1], kind: "apartment" },
  { id: "B30", footprint: [27, 5, 1, 2], kind: "civic" },
  { id: "B31", footprint: [1, 10, 1, 1], kind: "lowrise" },
  { id: "B32", footprint: [1, 19, 1, 1], kind: "civic" },
  { id: "B33", footprint: [10, 25, 2, 1], kind: "apartment" },
  { id: "B34", footprint: [26, 27, 1, 1], kind: "warehouse" },
  // Density fill — added to make the city feel populated.
  { id: "B35", footprint: [3, 5, 2, 3], kind: "apartment" },
  { id: "B36", footprint: [9, 3, 3, 3], kind: "civic" },
  { id: "B37", footprint: [9, 6, 3, 1], kind: "lowrise" },
  { id: "B38", footprint: [15, 3, 1, 3], kind: "apartment" },
  { id: "B39", footprint: [4, 9, 3, 2], kind: "apartment" },
  { id: "B40", footprint: [22, 9, 1, 3], kind: "lowrise" },
  { id: "B41", footprint: [13, 13, 1, 3], kind: "civic" },
  { id: "B42", footprint: [4, 17, 3, 2], kind: "apartment" },
  { id: "B43", footprint: [9, 13, 3, 1], kind: "civic" },
  { id: "B44", footprint: [22, 13, 3, 3], kind: "warehouse" },
  { id: "B45", footprint: [22, 17, 2, 2], kind: "apartment" },
  { id: "B46", footprint: [22, 25, 3, 3], kind: "apartment" },
  { id: "B48", footprint: [26, 13, 2, 3], kind: "apartment" },
  { id: "B50", footprint: [17, 9, 3, 1], kind: "lowrise" },
  // Second density pass — finer city block fill.
  { id: "B52", footprint: [6, 3, 1, 2], kind: "lowrise" },
  { id: "B53", footprint: [13, 6, 3, 2], kind: "civic" },
  { id: "B54", footprint: [17, 7, 3, 1], kind: "lowrise" },
  { id: "B55", footprint: [22, 7, 3, 1], kind: "warehouse" },
  { id: "B56", footprint: [25, 5, 2, 2], kind: "apartment" },
  { id: "B60", footprint: [26, 9, 2, 3], kind: "lowrise" },
  { id: "B61", footprint: [10, 14, 2, 2], kind: "apartment" },
  { id: "B62", footprint: [18, 13, 2, 3], kind: "civic" },
  { id: "B63", footprint: [18, 17, 2, 3], kind: "warehouse" },
  { id: "B64", footprint: [27, 17, 1, 3], kind: "lowrise" },
  { id: "B66", footprint: [13, 17, 1, 3], kind: "apartment" },
  { id: "B68", footprint: [3, 25, 3, 3], kind: "civic" },
  { id: "B69", footprint: [8, 23, 2, 4], kind: "apartment" },
  { id: "B70", footprint: [13, 25, 3, 3], kind: "lowrise" },
  { id: "B71", footprint: [17, 21, 3, 3], kind: "civic" },
  { id: "B72", footprint: [17, 25, 3, 3], kind: "apartment" },
  { id: "B73", footprint: [22, 21, 4, 1], kind: "lowrise" },
  { id: "B75", footprint: [22, 3, 2, 1], kind: "warehouse" },
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

/** Real-world heights at cell_size_m=10 (1 world unit = 10m).
 *  Apartment 12–20m, civic 8–14m, warehouse/lowrise 6–10m. */
export function buildingProfile(kind) {
  const profiles = {
    apartment: { color: 0x677382, roof: 0x222a32, minH: 1.2, maxH: 2.0, floors: 6 },
    civic: { color: 0x7d786c, roof: 0x252a2e, minH: 0.8, maxH: 1.4, floors: 4 },
    warehouse: { color: 0x5c6470, roof: 0x30343a, minH: 0.6, maxH: 1.0, floors: 2 },
    lowrise: { color: 0x766b5f, roof: 0x2b2927, minH: 0.6, maxH: 1.0, floors: 2 },
  };
  return profiles[kind] || profiles.lowrise;
}

/** No render expansion. Building shell fills its grid cells exactly so it never
 *  spills into adjacent road cells (which would visually overlap the asphalt). */
export function buildingRenderFootprint(x, y, w, d /* , height */) {
  return [x, y, w, d];
}

/** Returns the hand-placed layout plus a procedural infill pass that drops
 *  1x1 fillers in empty cells (avoiding roads, base, agents, victims, blockades,
 *  risk zones, and water/grass terrain). Deterministic via hash01 so the
 *  avoidance rects and the rendered geometry agree. */
export function scenarioBuildingEntries(scenario) {
  const defaults = get3DBuildings(scenario).map((b) => ({ ...b, synthetic: false }));
  const infill = proceduralBuildingInfill(scenario, defaults);
  return [...defaults, ...infill];
}

export function proceduralBuildingInfill(scenario, existingBuildings) {
  const [cols, rows] = scenario.map.size || [30, 30];
  const occupied = new Set();
  const mark = (x, y) => occupied.add(`${x},${y}`);

  for (const b of existingBuildings) {
    const [x, y, w, d] = b.footprint;
    for (let ix = x; ix < x + w; ix += 1) {
      for (let iy = y; iy < y + d; iy += 1) mark(ix, iy);
    }
  }
  for (const cell of computeRoadCells(scenario)) occupied.add(cell);
  if (scenario.map.base) {
    const [bx, by] = scenario.map.base;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) mark(bx + dx, by + dy);
    }
  }
  for (const a of scenario.agents || []) mark(a.location[0], a.location[1]);
  for (const v of scenario.victims || []) mark(v.location[0], v.location[1]);
  for (const bk of scenario.map.blocked_cells || []) mark(bk.location[0], bk.location[1]);
  for (const rz of scenario.map.risk_zones || []) {
    const [zx, zy] = rz.center;
    const r = Math.max(1, Math.ceil(rz.radius || 1));
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (dx * dx + dy * dy <= r * r) mark(zx + dx, zy + dy);
      }
    }
  }
  for (const t of get3DTerrain(scenario)) {
    if (t.kind !== "water" && t.kind !== "grass") continue;
    const [x, y, w, h] = t.footprint;
    for (let ix = x; ix < x + w; ix += 1) {
      for (let iy = y; iy < y + h; iy += 1) mark(ix, iy);
    }
  }

  const kinds = ["lowrise", "warehouse", "apartment", "civic"];
  const extras = [];
  let counter = 1000;
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (occupied.has(`${x},${y}`)) continue;
      if (hash01(x, y, 333) < 0.55) continue;
      const kind = kinds[Math.floor(hash01(x, y, 334) * kinds.length) % kinds.length];
      extras.push({ id: `BX${counter++}`, footprint: [x, y, 1, 1], kind, synthetic: true });
      mark(x, y);
    }
  }
  return extras;
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
