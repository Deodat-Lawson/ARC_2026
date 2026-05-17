import {
  VICTIM_HP_MIN,
  VICTIM_HP_RANGE,
  VICTIM_DMG_MIN,
  VICTIM_DMG_RANGE,
  roundScore,
} from "../config/constants.js";

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function tagBuildingDamage(buildings, riskZones, _cellSize) {
  if (!buildings?.length) return;
  const samplesPerCell = 2;
  for (const b of buildings) {
    const { minX, minY, maxX, maxY } = b.bounds;
    const w = maxX - minX;
    const h = maxY - minY;
    const stepX = Math.max(0.25, w / Math.max(1, Math.round(w * samplesPerCell)));
    const stepY = Math.max(0.25, h / Math.max(1, Math.round(h * samplesPerCell)));
    let totalSamples = 0;
    let collapseSamples = 0;
    let fireSamples = 0;
    let proximityHit = false;
    for (let sx = minX + stepX / 2; sx <= maxX; sx += stepX) {
      for (let sy = minY + stepY / 2; sy <= maxY; sy += stepY) {
        if (!pointInPolygon(sx, sy, b.polygon)) continue;
        totalSamples += 1;
        for (const z of riskZones || []) {
          const dx = sx - z.center[0];
          const dy = sy - z.center[1];
          const d = Math.hypot(dx, dy);
          if (d <= z.radius) {
            if (z.type === "collapse") collapseSamples += 1;
            else if (z.type === "fire") fireSamples += 1;
          } else if (d <= z.radius + 2.2) {
            proximityHit = true;
          }
        }
      }
    }
    if (totalSamples === 0) { b.damage = "intact"; continue; }
    const collapseFrac = collapseSamples / totalSamples;
    const fireFrac = fireSamples / totalSamples;
    if (collapseFrac >= 0.15) b.damage = "collapsed";
    else if (fireFrac >= 0.10) b.damage = "burning";
    else if (collapseSamples + fireSamples > 0 || proximityHit) b.damage = "damaged";
    else b.damage = "intact";
  }
}

export function buildBlockadeCandidatePool(damagedBuildings, roadSegments, gridSize) {
  if (!damagedBuildings.length || !roadSegments.length) return [];
  const out = [];
  const seen = new Set();
  const proximity = 1.4;
  for (const b of damagedBuildings) {
    const { minX, minY, maxX, maxY } = b.bounds;
    for (const seg of roadSegments) {
      const ax = seg.a.x;
      const ay = seg.a.y;
      const bx = seg.b.x;
      const by = seg.b.y;
      const midX = (ax + bx) / 2;
      const midY = (ay + by) / 2;
      if (midX < minX - proximity || midX > maxX + proximity) continue;
      if (midY < minY - proximity || midY > maxY + proximity) continue;
      const gx = Math.max(1, Math.min(gridSize - 2, Math.round(midX)));
      const gy = Math.max(1, Math.min(gridSize - 2, Math.round(midY)));
      const key = `${gx},${gy}`;
      if (seen.has(key)) continue;
      if (pointInPolygon(midX, midY, b.polygon)) continue;
      seen.add(key);
      out.push([gx, gy]);
    }
  }
  return out;
}

/**
 * @param {object} base - scenario JSON template
 * @param {object} cfg - readConfig() shape
 * @param {{ buildingFootprints?: object[], roadSegments?: object[] }} [geo]
 */
export function synthesizeScenario(base, cfg, geo = {}) {
  const buildingFootprints = geo.buildingFootprints || [];
  const roadSegments = geo.roadSegments || [];

  const rng = mulberry32((cfg.seed | 0) * 7919 + (cfg.victims | 0) * 31 + (cfg.grid | 0) * 17);
  const G = Math.max(20, Math.min(40, cfg.grid));
  const baseCell = [Math.max(1, Math.floor(G * 0.07)), Math.max(1, Math.floor(G * 0.07))];

  const occupied = new Set();
  const mark = (x, y, r = 1) => {
    for (let dx = -r; dx <= r; dx += 1)
      for (let dy = -r; dy <= r; dy += 1)
        occupied.add(`${x + dx},${y + dy}`);
  };
  mark(baseCell[0], baseCell[1], 2);

  const pickCell = (minDist = 4) => {
    for (let tries = 0; tries < 80; tries += 1) {
      const x = 1 + Math.floor(rng() * (G - 2));
      const y = 1 + Math.floor(rng() * (G - 2));
      if (occupied.has(`${x},${y}`)) continue;
      const d = Math.abs(x - baseCell[0]) + Math.abs(y - baseCell[1]);
      if (d < minDist) continue;
      return [x, y];
    }
    return [Math.floor(G / 2), Math.floor(G / 2)];
  };

  const riskZones = [];
  const radiusBase = 3 + Math.round(cfg.intensity * 2.5);
  for (let i = 0; i < cfg.fires; i += 1) {
    const c = pickCell(5);
    const radius = radiusBase + Math.floor(rng() * 2);
    riskZones.push({ id: `Z${riskZones.length + 1}`, center: c, radius, type: "fire", risk: 0.4 + cfg.intensity * 0.5 });
    mark(c[0], c[1], radius);
  }
  for (let i = 0; i < cfg.collapses; i += 1) {
    const c = pickCell(5);
    const radius = radiusBase + 1 + Math.floor(rng() * 2);
    riskZones.push({ id: `Z${riskZones.length + 1}`, center: c, radius, type: "collapse", risk: 0.35 + cfg.intensity * 0.45 });
    mark(c[0], c[1], radius);
  }

  const deadAnchor = riskZones.length ? riskZones[0].center : pickCell(6);
  const deadZones = cfg.deadRadius > 0 ? [{
    id: "C1",
    center: deadAnchor,
    radius: cfg.deadRadius,
    dropout_addition: Math.max(0.1, cfg.dropout * 2)
  }] : [];

  const synthBuildings = buildingFootprints.map((b) => ({
    id: b.id,
    polygon: b.polygon,
    centroid: b.centroid,
    area: b.area,
    bounds: b.bounds,
    damage: "intact",
  }));
  tagBuildingDamage(synthBuildings, riskZones, cfg.cellSize || 10);
  const damagedPool = synthBuildings.filter((b) => b.damage !== "intact");

  const blockades = [];
  const blockadeCandidates = damagedPool.length && roadSegments.length
    ? buildBlockadeCandidatePool(damagedPool, roadSegments, G)
    : [];
  for (let i = 0; i < cfg.blockades; i += 1) {
    let loc = null;
    if (blockadeCandidates.length) {
      for (let tries = 0; tries < 8 && !loc; tries += 1) {
        const idx = Math.floor(rng() * blockadeCandidates.length);
        const cand = blockadeCandidates[idx];
        if (!cand || occupied.has(`${cand[0]},${cand[1]}`)) continue;
        loc = cand;
      }
    }
    if (!loc) loc = pickCell(3);
    blockades.push({
      id: `K${i + 1}`,
      location: loc,
      repair_cost: 60 + Math.floor(rng() * 30),
      clear_progress: 0,
      status: "blocked"
    });
    mark(loc[0], loc[1], 1);
  }

  const victims = [];
  const pickVictimCell = () => {
    if (!synthBuildings.length) return pickCell(4);
    const weights = { collapsed: 3, damaged: 2, burning: 1, intact: 0.25 };
    let total = 0;
    for (const b of synthBuildings) total += weights[b.damage] * Math.min(b.area, 6);
    if (total <= 0) return pickCell(4);
    let r = rng() * total;
    let pick = synthBuildings[0];
    for (const b of synthBuildings) {
      r -= weights[b.damage] * Math.min(b.area, 6);
      if (r <= 0) { pick = b; break; }
    }
    const { minX, minY, maxX, maxY } = pick.bounds;
    for (let tries = 0; tries < 12; tries += 1) {
      const cx = pick.centroid[0] + (rng() - 0.5) * (maxX - minX) * 0.6;
      const cy = pick.centroid[1] + (rng() - 0.5) * (maxY - minY) * 0.6;
      const gx = Math.max(1, Math.min(G - 2, Math.round(cx)));
      const gy = Math.max(1, Math.min(G - 2, Math.round(cy)));
      if (occupied.has(`${gx},${gy}`)) continue;
      if (!pointInPolygon(cx, cy, pick.polygon)) continue;
      return [gx, gy];
    }
    return pickCell(4);
  };
  for (let i = 0; i < cfg.victims; i += 1) {
    const loc = pickVictimCell();
    const sev = cfg.severity * (0.6 + rng() * 0.8);
    const hp_max = VICTIM_HP_MIN + Math.floor(rng() * VICTIM_HP_RANGE);
    const damage_per_step = Math.round(VICTIM_DMG_MIN + sev * VICTIM_DMG_RANGE);
    victims.push({
      id: `V${i + 1}`,
      location: loc,
      hp: hp_max,
      hp_max,
      survival_pct: 100,
      damage_per_step,
      thermal_signal: roundScore(0.25 + rng() * 0.7),
      status: rng() < 0.85 ? "trapped" : "unknown"
    });
    mark(loc[0], loc[1], 1);
  }

  const agentTemplates = (base && base.agents) || [];
  const agents = [];
  let spawn = 0;
  const ring = [
    [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1]
  ];
  const place = () => {
    const [dx, dy] = ring[spawn % ring.length] || [0, 0];
    spawn += 1;
    return [baseCell[0] + dx, baseCell[1] + dy];
  };
  const pickTpl = (kind, role) =>
    agentTemplates.find((a) => a.type === kind && a.role === role) ||
    agentTemplates.find((a) => a.type === kind) ||
    null;

  for (let i = 0; i < cfg.scout; i += 1) {
    const tpl = pickTpl("drone", "scout");
    agents.push({
      ...(tpl || {}),
      id: `Drone-${agents.filter((a) => a.type === "drone").length + 1}`,
      type: "drone",
      role: "scout",
      location: place(),
      battery: cfg.battery,
      speed: 3,
      perception_range: 6,
      sensors: ["thermal", "camera", "audio"],
      payload: "medical_beacon"
    });
  }
  for (let i = 0; i < cfg.relay; i += 1) {
    agents.push({
      id: `Drone-${agents.filter((a) => a.type === "drone").length + 1}`,
      type: "drone",
      role: "relay",
      location: place(),
      battery: cfg.battery,
      speed: 3,
      perception_range: 5,
      sensors: ["camera", "audio"],
      payload: "radio_relay"
    });
  }
  for (let i = 0; i < cfg.rescue; i += 1) {
    agents.push({
      id: `UGV-${agents.filter((a) => a.type === "ground_rescue").length + 1}`,
      type: "ground_rescue",
      role: "rescue",
      location: place(),
      battery: cfg.battery,
      speed: 1,
      perception_range: 3,
      sensors: ["audio", "vibration"],
      payload: "first_aid_pack"
    });
  }
  for (let i = 0; i < cfg.clearN; i += 1) {
    agents.push({
      id: `UGV-${agents.filter((a) => a.type === "ground_clear").length + agents.filter((a) => a.type === "ground_rescue").length + 1}`,
      type: "ground_clear",
      role: "clear_blockade",
      location: place(),
      battery: cfg.battery,
      speed: 1,
      perception_range: 3,
      clear_rate: 20,
      sensors: ["camera"],
      payload: "rubble_clear_tool"
    });
  }
  for (let i = 0; i < cfg.balloons; i += 1) {
    agents.push({
      id: `BAL-${agents.filter((a) => a.type === "balloon").length + 1}`,
      type: "balloon",
      role: "relay",
      location: place(),
      battery: cfg.battery,
      speed: 0.5,
      perception_range: 12,
      sensors: ["camera", "audio"],
      payload: "comm_relay"
    });
  }
  for (let i = 0; i < cfg.armored; i += 1) {
    agents.push({
      id: `AAV-${agents.filter((a) => a.type === "ground_armored").length + 1}`,
      type: "ground_armored",
      role: "rescue",
      location: place(),
      battery: cfg.battery,
      speed: 1,
      perception_range: 4,
      sensors: ["thermal", "audio", "vibration"],
      payload: "rescue_pod",
      risk_immune: true
    });
  }
  if (agents.length === 0 && agentTemplates.length) {
    agents.push(JSON.parse(JSON.stringify(agentTemplates[0])));
  }

  const baseMap = base?.map || {};
  const baseSize = baseMap.size?.[0] || G;
  const scale = G / Math.max(1, baseSize);
  const clampCell = (v) => Math.max(0, Math.min(G - 1, Math.round(v * scale)));
  const scaleFootprint = ([x, y, w, h]) => {
    const sx = clampCell(x);
    const sy = clampCell(y);
    const ex = Math.max(sx + 1, clampCell(x + w));
    const ey = Math.max(sy + 1, clampCell(y + h));
    return [sx, sy, Math.max(1, Math.min(G - sx, ex - sx)), Math.max(1, Math.min(G - sy, ey - sy))];
  };
  const terrain = (baseMap.terrain || []).map((t) => ({ ...t, footprint: scaleFootprint(t.footprint) }));
  const buildings = (baseMap.buildings || []).map((b) => ({ ...b, footprint: scaleFootprint(b.footprint) }));
  const roads = (baseMap.roads || []).map((r) => ({
    ...r,
    points: (r.points || []).map(([x, y]) => [clampCell(x), clampCell(y)])
  }));

  return {
    scenario_id: cfg.missionId.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "msn_synth",
    description: base?.description ||
      `Synthesized scenario: ${cfg.victims} victims · ${cfg.fires + cfg.collapses} hazard zones · ${cfg.blockades} blockades.`,
    map: {
      size: [G, G],
      cell_size_m: cfg.cellSize,
      base: baseCell,
      refuges: [{ id: "R0", location: baseCell }],
      blocked_cells: blockades,
      risk_zones: riskZones,
      communication_dead_zones: deadZones,
      terrain,
      roads,
      buildings
    },
    victims,
    agents,
    communication: {
      base_range: cfg.baseRange,
      relay_range: cfg.relayRange,
      direct_comm_range: 4,
      bandwidth_limit: 3,
      base_dropout_probability: cfg.dropout
    }
  };
}
