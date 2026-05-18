import { PRESET_VISUAL } from "../../config/presets.js";
import { pointInPolygon } from "../../scenario/synthesize.js";
import { distance, lerp } from "../../sim/math.js";
import { drawIndustrialPlanUnderlay } from "./industrial-plan.js";

/** @typedef {object} Map2DEnv
 * @property {CanvasRenderingContext2D} ctx
 * @property {HTMLCanvasElement} canvas
 * @property {number} t
 * @property {object} state
 * @property {Map} trails
 * @property {number} lastTickAt
 * @property {boolean} tacticalBaseMapReady
 * @property {string} scenePreset
 * @property {number} msPerTick
 */

/** Mutable draw pass context — cleared after each frame. */
let E = null;

/** Tactical grid canvas: basemap tint, hazards, agents, trails. */
export function drawMap2D(env) {
  E = env;
  try {
    if (!E.state) return;
    const t = E.t;
    const [cols, rows] = E.state.map.size;
    const cell = E.canvas.width / cols;
    E.ctx.clearRect(0, 0, E.canvas.width, E.canvas.height);

    if (E.scenePreset === "industrial") {
      drawIndustrialPlanUnderlay(E.ctx, E.canvas.width, E.canvas.height);
      drawGrid(cols, rows, cell);
      drawBlockades(cell);
      drawVictims(cell, t);
      drawBase(cell);
      drawAgents(cell, t);
      return;
    }

    drawGrid(cols, rows, cell);
    drawCommunication(cell, t);
    drawBuildingDamage(cell, t);
    drawRiskZones(cell, t);
    drawBlockades(cell);
    drawVictims(cell, t);
    drawBase(cell);
    drawAgents(cell, t);
  } finally {
    E = null;
  }
}

function drawGrid(cols, rows, cell) {
  if (E.scenePreset === "industrial") {
    // GLB plan only — no urban_quake tint sheet or fake arterial corridors.
    E.ctx.strokeStyle = "rgba(185, 198, 212, 0.26)";
    E.ctx.lineWidth = 0.55;
    for (let i = 0; i <= cols; i += 1) {
      E.ctx.beginPath();
      E.ctx.moveTo(i * cell, 0);
      E.ctx.lineTo(i * cell, E.canvas.height);
      E.ctx.stroke();
    }
    for (let i = 0; i <= rows; i += 1) {
      E.ctx.beginPath();
      E.ctx.moveTo(0, i * cell);
      E.ctx.lineTo(E.canvas.width, i * cell);
      E.ctx.stroke();
    }
    return;
  }

  const c2 = (PRESET_VISUAL[E.scenePreset] || PRESET_VISUAL.urban_quake).canvas2d;
  const fillStyle = E.tacticalBaseMapReady ? c2.overlay : "#04060a";
  E.ctx.fillStyle = fillStyle;
  E.ctx.fillRect(0, 0, E.canvas.width, E.canvas.height);
  E.ctx.strokeStyle = E.tacticalBaseMapReady ? c2.gridStroke : "rgba(255, 255, 255, 0.04)";
  E.ctx.lineWidth = 0.5;
  for (let i = 0; i <= cols; i += 1) {
    E.ctx.beginPath();
    E.ctx.moveTo(i * cell, 0);
    E.ctx.lineTo(i * cell, E.canvas.height);
    E.ctx.stroke();
  }
  for (let i = 0; i <= rows; i += 1) {
    E.ctx.beginPath();
    E.ctx.moveTo(0, i * cell);
    E.ctx.lineTo(E.canvas.width, i * cell);
    E.ctx.stroke();
  }
  E.ctx.fillStyle = E.tacticalBaseMapReady ? c2.arterial : "rgba(60, 80, 110, 0.32)";
  for (let y = 2; y < rows; y += 5) E.ctx.fillRect(0, y * cell + cell * 0.28, E.canvas.width, cell * 0.44);
  for (let x = 2; x < cols; x += 6) E.ctx.fillRect(x * cell + cell * 0.28, 0, cell * 0.44, E.canvas.height);
}

function drawCommunication(cell, t) {
  for (const zone of E.state.map.communication_dead_zones) {
    const px = zone.center[0] * cell;
    const py = zone.center[1] * cell;
    const r = zone.radius * cell;

    E.ctx.save();
    E.ctx.globalAlpha = 0.18;
    E.ctx.fillStyle = "#334466";
    E.ctx.beginPath();
    E.ctx.arc(px, py, r, 0, Math.PI * 2);
    E.ctx.fill();

    E.ctx.globalAlpha = 0.4;
    E.ctx.fillStyle = "#88aacc";
    const seedBase = zone.id ? zone.id.charCodeAt(0) : 7;
    for (let i = 0; i < 60; i += 1) {
      const seed = seedBase + i;
      const angle = (Math.sin(seed * 12.9898) * 0.5 + 0.5) * Math.PI * 2 + t * 0.4;
      const radial = ((Math.sin(seed * 78.233) * 0.5 + 0.5 + t * 0.05 * (i % 3 + 1)) % 1) * r;
      const dx = px + radial * Math.cos(angle);
      const dy = py + radial * Math.sin(angle);
      E.ctx.fillRect(dx - 0.75, dy - 0.75, 1.5, 1.5);
    }
    E.ctx.restore();

    E.ctx.save();
    E.ctx.strokeStyle = "rgba(136,170,204,0.55)";
    E.ctx.setLineDash([8, 6]);
    E.ctx.lineDashOffset = -t * 12;
    E.ctx.beginPath();
    E.ctx.arc(px, py, r, 0, Math.PI * 2);
    E.ctx.stroke();
    E.ctx.restore();
  }

  const relay = E.state.agents.find((agent) => agent.id === "Drone-2");
  if (relay && distance(relay.location, [14, 7]) <= 1.5) {
    const px = relay.location[0] * cell;
    const py = relay.location[1] * cell;
    const r = E.state.communication.relay_range * cell;
    const pulse = 1 + Math.sin(t * 1.5) * 0.04;
    E.ctx.fillStyle = "rgba(200, 180, 255, 0.10)";
    E.ctx.beginPath();
    E.ctx.arc(px, py, r * pulse, 0, Math.PI * 2);
    E.ctx.fill();
    E.ctx.strokeStyle = "rgba(200, 180, 255, 0.45)";
    E.ctx.lineWidth = 1;
    E.ctx.stroke();
  }
}

function tracePolygonPath(ring, cell) {
  if (!ring || ring.length < 2) return;
  E.ctx.beginPath();
  E.ctx.moveTo(ring[0][0] * cell, ring[0][1] * cell);
  for (let i = 1; i < ring.length; i += 1) {
    E.ctx.lineTo(ring[i][0] * cell, ring[i][1] * cell);
  }
  E.ctx.closePath();
}

function buildingSeedHash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function drawBuildingDamage(cell, t) {
  const buildings = E.state.tacticalBuildings;
  if (!buildings || !buildings.length) return;
  let smokeBudget = 14;
  for (const b of buildings) {
    if (b.damage === "intact") continue;
    const seed = buildingSeedHash(b.id);
    const rnd = (k) => {
      const v = Math.sin(seed * 0.0001 + k * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };

    if (b.damage === "collapsed") {
      // Fully erase the building — fill with dark rubble, blot out the basemap polygon
      tracePolygonPath(b.polygon, cell);
      E.ctx.fillStyle = "rgba(48, 32, 22, 0.92)";
      E.ctx.fill();
      // Crumbled outline (dashed, broken)
      E.ctx.save();
      E.ctx.strokeStyle = "rgba(120, 85, 50, 0.85)";
      E.ctx.lineWidth = 1.6;
      E.ctx.setLineDash([3, 4]);
      tracePolygonPath(b.polygon, cell);
      E.ctx.stroke();
      E.ctx.restore();
      // Heavy rubble scatter
      const specks = 14 + Math.floor(rnd(0) * 10);
      const { minX, minY, maxX, maxY } = b.bounds;
      for (let i = 0; i < specks; i += 1) {
        let sx, sy;
        for (let tries = 0; tries < 6; tries += 1) {
          sx = minX + rnd(i * 2 + 1) * (maxX - minX);
          sy = minY + rnd(i * 2 + 2) * (maxY - minY);
          if (pointInPolygon(sx, sy, b.polygon)) break;
        }
        if (!pointInPolygon(sx, sy, b.polygon)) continue;
        const palette = ["#6b4a2a", "#8b5a2a", "#a07246", "#5a3e26"];
        E.ctx.fillStyle = palette[i % palette.length];
        const w = 2 + rnd(i + 100) * 2.4;
        const h = 1.6 + rnd(i + 101) * 1.8;
        E.ctx.save();
        E.ctx.translate(sx * cell, sy * cell);
        E.ctx.rotate(rnd(i + 102) * Math.PI);
        E.ctx.fillRect(-w / 2, -h / 2, w, h);
        E.ctx.restore();
      }
      // Dust plume from the wreckage
      const [cx, cy] = b.centroid;
      for (let j = 0; j < 3; j += 1) {
        const rise = ((t * 0.28 + j * 0.4 + rnd(j + 200)) % 1.5);
        const drift = Math.sin(t * 0.4 + j * 1.3 + seed * 0.001) * 1.4;
        const radius = (2.4 + rise * 6) * (cell / 14);
        E.ctx.save();
        E.ctx.globalAlpha = Math.max(0, 0.42 - rise * 0.3);
        E.ctx.fillStyle = "rgba(80, 65, 55, 1)";
        E.ctx.beginPath();
        E.ctx.arc((cx + drift) * cell, (cy - rise * 4) * cell, radius, 0, Math.PI * 2);
        E.ctx.fill();
        E.ctx.restore();
      }
    } else if (b.damage === "burning") {
      // Bright glowing fill that pulses dramatically
      const pulse = 0.55 + Math.sin(t * 2.2 + seed * 0.001) * 0.25;
      tracePolygonPath(b.polygon, cell);
      E.ctx.fillStyle = `rgba(255, 130, 55, ${0.55 * pulse})`;
      E.ctx.fill();
      // Inner core glow
      tracePolygonPath(b.polygon, cell);
      const [cx, cy] = b.centroid;
      const innerGlow = E.ctx.createRadialGradient(
        cx * cell, cy * cell, 0,
        cx * cell, cy * cell, Math.max((b.bounds.maxX - b.bounds.minX), (b.bounds.maxY - b.bounds.minY)) * cell * 0.7
      );
      innerGlow.addColorStop(0, `rgba(255, 220, 130, ${0.55 * pulse})`);
      innerGlow.addColorStop(0.5, `rgba(255, 100, 40, ${0.30 * pulse})`);
      innerGlow.addColorStop(1, "rgba(180, 50, 20, 0)");
      E.ctx.save();
      E.ctx.fillStyle = innerGlow;
      E.ctx.fill();
      E.ctx.restore();
      // Glowing outline
      E.ctx.save();
      E.ctx.strokeStyle = `rgba(255, 130, 50, ${0.85 * pulse})`;
      E.ctx.lineWidth = 1.6;
      E.ctx.shadowColor = "rgba(255, 110, 30, 0.75)";
      E.ctx.shadowBlur = 12;
      tracePolygonPath(b.polygon, cell);
      E.ctx.stroke();
      E.ctx.restore();
      if (smokeBudget > 0) {
        smokeBudget -= 1;
        const [cx, cy] = b.centroid;
        for (let i = 0; i < 6; i += 1) {
          const drift = Math.sin(t * 0.4 + seed * 0.001 + i * 1.7);
          const rise = (t * 0.45 + i * 0.32 + rnd(i + 10)) % 2.0;
          const ox = drift * (1 + rise * 2);
          const oy = -rise * 5;
          const px = (cx + ox) * cell;
          const py = (cy + oy) * cell;
          const radius = (3.5 + rise * 9) * (cell / 12);
          E.ctx.save();
          E.ctx.globalAlpha = Math.max(0, 0.55 - rise * 0.28);
          E.ctx.fillStyle = "rgba(28, 22, 22, 1)";
          E.ctx.beginPath();
          E.ctx.arc(px, py, radius, 0, Math.PI * 2);
          E.ctx.fill();
          E.ctx.restore();
        }
      }
    } else if (b.damage === "damaged") {
      E.ctx.save();
      E.ctx.strokeStyle = "rgba(255, 217, 93, 0.55)";
      E.ctx.lineWidth = 1.0;
      tracePolygonPath(b.polygon, cell);
      E.ctx.stroke();
      const { minX, minY, maxX, maxY } = b.bounds;
      E.ctx.strokeStyle = "rgba(255, 217, 93, 0.35)";
      E.ctx.lineWidth = 0.8;
      for (let i = 0; i < 3; i += 1) {
        const ax = minX + rnd(i + 1) * (maxX - minX);
        const ay = minY + rnd(i + 2) * (maxY - minY);
        const bx = ax + (rnd(i + 3) - 0.5) * 1.2;
        const by = ay + (rnd(i + 4) - 0.5) * 1.2;
        if (!pointInPolygon(ax, ay, b.polygon)) continue;
        E.ctx.beginPath();
        E.ctx.moveTo(ax * cell, ay * cell);
        E.ctx.lineTo(bx * cell, by * cell);
        E.ctx.stroke();
      }
      E.ctx.restore();
    }
  }
}

function zoneSeedHash(id) {
  let h = 2166136261;
  const s = String(id || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function drawRiskZones(cell, t) {
  // Pre-pass: large translucent ash haze for every zone, painted first so other
  // overlays sit on top. Gives the whole quadrant a "dust in the air" wash.
  for (const zone of E.state.map.risk_zones) {
    const px = zone.center[0] * cell;
    const py = zone.center[1] * cell;
    const r = zone.radius * cell;
    const hazeR = r * 2.4;
    const isFire = zone.type === "fire";
    const haze = E.ctx.createRadialGradient(px, py, r * 0.4, px, py, hazeR);
    if (isFire) {
      haze.addColorStop(0, "rgba(80, 25, 10, 0.42)");
      haze.addColorStop(0.55, "rgba(60, 30, 20, 0.18)");
      haze.addColorStop(1, "rgba(40, 30, 25, 0)");
    } else {
      haze.addColorStop(0, "rgba(35, 30, 25, 0.48)");
      haze.addColorStop(0.55, "rgba(40, 38, 38, 0.22)");
      haze.addColorStop(1, "rgba(35, 35, 40, 0)");
    }
    E.ctx.fillStyle = haze;
    E.ctx.beginPath();
    E.ctx.arc(px, py, hazeR, 0, Math.PI * 2);
    E.ctx.fill();
  }

  for (const zone of E.state.map.risk_zones) {
    const px = zone.center[0] * cell;
    const py = zone.center[1] * cell;
    const r = zone.radius * cell;
    const isFire = zone.type === "fire";
    const seed = zoneSeedHash(zone.id || `${zone.type}-${zone.center.join(",")}`);
    const rnd = (k) => {
      const v = Math.sin(seed * 0.0001 + k * 12.9898 + (zone.center[0] + zone.center[1]) * 0.31) * 43758.5453;
      return v - Math.floor(v);
    };

    if (isFire) {
      // Flickering orange core
      const pulse = 0.55 + Math.sin(t * 1.8 + seed * 0.001) * 0.15;
      const core = E.ctx.createRadialGradient(px, py, 0, px, py, r);
      core.addColorStop(0, `rgba(255, 150, 60, ${0.55 * pulse})`);
      core.addColorStop(0.45, `rgba(255, 90, 30, ${0.42 * pulse})`);
      core.addColorStop(1, "rgba(180, 50, 20, 0)");
      E.ctx.fillStyle = core;
      E.ctx.beginPath();
      E.ctx.arc(px, py, r, 0, Math.PI * 2);
      E.ctx.fill();

      // Ember sparks across the zone — many small bright dots, animated
      const emberCount = Math.floor(r * 0.6);
      for (let i = 0; i < emberCount; i += 1) {
        const ang = rnd(i * 2) * Math.PI * 2;
        const rad = Math.sqrt(rnd(i * 2 + 1)) * r * 0.95;
        const flicker = 0.5 + Math.sin(t * 4.0 + i * 1.7 + seed * 0.001) * 0.5;
        const ex = px + Math.cos(ang) * rad;
        const ey = py + Math.sin(ang) * rad;
        E.ctx.fillStyle = `rgba(255, ${160 + Math.floor(flicker * 70)}, 40, ${0.35 + flicker * 0.5})`;
        E.ctx.fillRect(ex - 0.9, ey - 0.9, 1.8, 1.8);
      }

      // Multiple smoke plumes rising from random anchor points across the zone
      const plumeCount = 5 + Math.floor(rnd(99) * 3);
      for (let i = 0; i < plumeCount; i += 1) {
        const ang = rnd(i * 3 + 30) * Math.PI * 2;
        const rad = Math.sqrt(rnd(i * 3 + 31)) * r * 0.8;
        const sx = px + Math.cos(ang) * rad;
        const sy = py + Math.sin(ang) * rad;
        const drift = Math.sin(t * 0.4 + seed * 0.001 + i * 1.3);
        for (let j = 0; j < 5; j += 1) {
          const rise = ((t * 0.35 + j * 0.4 + rnd(i * 5 + j)) % 1.7);
          const ox = drift * (1.5 + rise * 2.5);
          const oy = -rise * (r * 1.2);
          const radius = (3 + rise * 8) * (cell / 14);
          E.ctx.save();
          E.ctx.globalAlpha = Math.max(0, 0.55 - rise * 0.32);
          E.ctx.fillStyle = "rgba(28, 22, 22, 1)";
          E.ctx.beginPath();
          E.ctx.arc(sx + ox, sy + oy, radius, 0, Math.PI * 2);
          E.ctx.fill();
          E.ctx.restore();
        }
      }

      // Bright glowing perimeter ring
      E.ctx.save();
      E.ctx.strokeStyle = `rgba(255, 120, 40, ${0.6 + Math.sin(t * 2) * 0.18})`;
      E.ctx.lineWidth = 1.4;
      E.ctx.shadowColor = "rgba(255, 90, 30, 0.55)";
      E.ctx.shadowBlur = 10;
      E.ctx.beginPath();
      E.ctx.arc(px, py, r, 0, Math.PI * 2);
      E.ctx.stroke();
      E.ctx.restore();
    } else {
      // Collapse zone — dense rubble field across the radius
      const dust = E.ctx.createRadialGradient(px, py, 0, px, py, r);
      dust.addColorStop(0, "rgba(70, 55, 40, 0.45)");
      dust.addColorStop(0.6, "rgba(60, 50, 40, 0.30)");
      dust.addColorStop(1, "rgba(60, 50, 40, 0)");
      E.ctx.fillStyle = dust;
      E.ctx.beginPath();
      E.ctx.arc(px, py, r, 0, Math.PI * 2);
      E.ctx.fill();

      // Rubble scatter — dense across the whole radius, deterministic
      const rubbleCount = Math.floor(r * r * 0.018);
      for (let i = 0; i < rubbleCount; i += 1) {
        const ang = rnd(i * 2) * Math.PI * 2;
        const rad = Math.sqrt(rnd(i * 2 + 1)) * r * 0.95;
        const rx = px + Math.cos(ang) * rad;
        const ry = py + Math.sin(ang) * rad;
        const variant = i % 4;
        const palette = ["#5a3e26", "#7a5436", "#8b6232", "#624227"];
        const w = 1.6 + rnd(i * 2 + 2) * 2.2;
        const h = 1.4 + rnd(i * 2 + 3) * 1.6;
        E.ctx.save();
        E.ctx.translate(rx, ry);
        E.ctx.rotate(rnd(i * 2 + 4) * Math.PI);
        E.ctx.fillStyle = palette[variant];
        E.ctx.globalAlpha = 0.72;
        E.ctx.fillRect(-w / 2, -h / 2, w, h);
        E.ctx.restore();
      }

      // Ground fissures — jagged cracks radiating outward from epicenter
      const fissureCount = 4 + Math.floor(rnd(50) * 3);
      for (let i = 0; i < fissureCount; i += 1) {
        const baseAng = (i / fissureCount) * Math.PI * 2 + rnd(i + 60) * 0.4;
        const len = r * (0.7 + rnd(i + 61) * 0.6);
        let cx = px;
        let cy = py;
        const segments = 6;
        E.ctx.save();
        E.ctx.strokeStyle = "rgba(15, 10, 8, 0.85)";
        E.ctx.lineWidth = 1.4;
        E.ctx.beginPath();
        E.ctx.moveTo(cx, cy);
        for (let s = 1; s <= segments; s += 1) {
          const step = len / segments;
          const wobble = (rnd(i * 10 + s) - 0.5) * 0.6;
          const ang = baseAng + wobble;
          cx += Math.cos(ang) * step;
          cy += Math.sin(ang) * step;
          E.ctx.lineTo(cx, cy);
        }
        E.ctx.stroke();
        // Outer faint glow on fissure
        E.ctx.strokeStyle = "rgba(255, 200, 120, 0.18)";
        E.ctx.lineWidth = 3.2;
        E.ctx.stroke();
        E.ctx.restore();
      }

      // Central dust column — vertical smoke plume from the epicenter
      for (let j = 0; j < 6; j += 1) {
        const rise = ((t * 0.3 + j * 0.35) % 1.8);
        const drift = Math.sin(t * 0.5 + j * 1.1 + seed * 0.001) * 2.5;
        const ox = drift;
        const oy = -rise * (r * 1.4);
        const radius = (4 + rise * 9) * (cell / 14);
        E.ctx.save();
        E.ctx.globalAlpha = Math.max(0, 0.45 - rise * 0.26);
        E.ctx.fillStyle = "rgba(60, 50, 45, 1)";
        E.ctx.beginPath();
        E.ctx.arc(px + ox, py + oy, radius, 0, Math.PI * 2);
        E.ctx.fill();
        E.ctx.restore();
      }

      // Perimeter ring (subtle)
      E.ctx.save();
      E.ctx.strokeStyle = "rgba(140, 110, 80, 0.45)";
      E.ctx.lineWidth = 1.1;
      E.ctx.setLineDash([6, 4]);
      E.ctx.beginPath();
      E.ctx.arc(px, py, r, 0, Math.PI * 2);
      E.ctx.stroke();
      E.ctx.restore();
    }

    // Label
    E.ctx.fillStyle = isFire ? "rgba(255, 200, 130, 0.95)" : "rgba(220, 200, 175, 0.92)";
    E.ctx.font = "bold 10px 'JetBrains Mono', 'Courier New', monospace";
    const label = zone.type.toUpperCase();
    E.ctx.shadowColor = "rgba(0,0,0,0.85)";
    E.ctx.shadowBlur = 4;
    E.ctx.fillText(label, px - label.length * 3, py + 3);
    E.ctx.shadowBlur = 0;
  }
}

function drawBlockades(cell) {
  for (const blockade of E.state.map.blocked_cells) {
    const [x, y] = blockade.location;
    if (blockade.status === "cleared") {
      E.ctx.fillStyle = "rgba(93,255,180,0.08)";
      E.ctx.fillRect(x * cell, y * cell, cell, cell);
      continue;
    }
    E.ctx.fillStyle = "rgba(139,69,19,0.5)";
    E.ctx.fillRect(x * cell, y * cell, cell, cell);
    E.ctx.strokeStyle = "#8b4513";
    E.ctx.lineWidth = 1;
    E.ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    E.ctx.fillStyle = "#a0522d";
    E.ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
    E.ctx.fillText("BLK", x * cell + 2, y * cell + cell / 2 + 3);
    const progress = blockade.clear_progress / blockade.repair_cost;
    E.ctx.fillStyle = "#ffd95d";
    E.ctx.fillRect(x * cell + 3, y * cell + cell - 5, (cell - 6) * progress, 2);
  }
}

function drawVictims(cell, t) {
  for (const victim of E.state.victims) {
    const [x, y] = victim.location;
    const px = (x + 0.5) * cell;
    const py = (y + 0.5) * cell;
    const color = victim.status === "rescued"
      ? "#5dffb4"
      : victim.status === "dead"
        ? "#4a4d54"
        : "#ff8a8a";

    if (victim.status === "trapped") {
      const halo = 0.5 + 0.5 * (Math.sin(t * 3) * 0.5 + 0.5);
      E.ctx.save();
      E.ctx.globalAlpha = 0.18 * halo;
      E.ctx.fillStyle = color;
      E.ctx.beginPath();
      E.ctx.arc(px, py, cell * 0.55, 0, Math.PI * 2);
      E.ctx.fill();
      E.ctx.restore();
    }

    E.ctx.save();
    E.ctx.fillStyle = color;
    E.ctx.shadowBlur = victim.status === "trapped" ? 8 : 3;
    E.ctx.shadowColor = color;
    const armW = Math.max(2, cell * 0.1);
    const armL = Math.max(8, cell * 0.4);
    E.ctx.fillRect(px - armW / 2, py - armL / 2, armW, armL);
    E.ctx.fillRect(px - armL / 2, py - armW / 2, armL, armW);
    E.ctx.shadowBlur = 0;
    E.ctx.restore();

    E.ctx.fillStyle = color;
    E.ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
    E.ctx.fillText(victim.id, px - 8, py - cell * 0.42);

    if (victim.status === "trapped" || victim.status === "unknown") {
      const pct = Math.max(0, Math.min(1, victim.survival_pct / 100));
      const barW = cell * 0.7;
      const barH = 3;
      const barX = px - barW / 2;
      const barY = py + cell * 0.3;
      E.ctx.fillStyle = "rgba(0,0,0,0.6)";
      E.ctx.fillRect(barX, barY, barW, barH);
      const r = Math.round(255 * (1 - pct));
      const g = Math.round(180 * pct);
      E.ctx.fillStyle = `rgb(${r},${g},0)`;
      E.ctx.fillRect(barX, barY, barW * pct, barH);
    }
  }
}

function drawBase(cell) {
  const [x, y] = E.state.map.base;
  E.ctx.save();
  E.ctx.strokeStyle = "#ffd95d";
  E.ctx.lineWidth = 1.5;
  E.ctx.shadowBlur = 8;
  E.ctx.shadowColor = "#ffd95d";
  E.ctx.strokeRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
  E.ctx.shadowBlur = 0;
  E.ctx.fillStyle = "#ffd95d";
  E.ctx.font = "bold 9px 'JetBrains Mono', 'Courier New', monospace";
  E.ctx.fillText("BASE", x * cell + 1, y * cell + cell / 2 + 3);
  E.ctx.restore();
}

function drawAgents(cell, t) {
  const frac = Math.min(1, Math.max(0, (performance.now() - E.lastTickAt) / E.msPerTick));
  for (const agent of E.state.agents) {
    const prev = agent.prevLocation || agent.location;
    const ix = lerp(prev[0], agent.location[0], frac);
    const iy = lerp(prev[1], agent.location[1], frac);
    const px = (ix + 0.5) * cell;
    const py = (iy + 0.5) * cell;
    const battery = (agent.battery || 0) / 100;
    const trail = E.trails.get(agent.id);

    let labelColor;
    if (agent.type === "drone") {
      drawUAV(px, py, cell, battery, agent.perception_range || 4, t, trail);
      labelColor = "#82c8ff";
    } else if (agent.type === "balloon") {
      drawBalloon(px, py, cell, battery, agent.perception_range || 10, t);
      labelColor = "#c8b4ff";
    } else if (agent.type === "ground_armored") {
      drawArmored(px, py, cell, battery, t, trail);
      labelColor = "#ff8c3c";
    } else {
      drawUGV(px, py, cell, battery, t, trail);
      labelColor = "#5dffb4";
    }
    drawAgentLabel(agent.id, px, py, labelColor);
  }
}

function drawTrail(trail, cell, color) {
  if (!trail || trail.length < 2) return;
  for (let i = 1; i < trail.length; i += 1) {
    const a = trail[i - 1];
    const b = trail[i];
    const alpha = (i / trail.length) * 0.5;
    E.ctx.strokeStyle = color.replace(")", `,${alpha})`).replace("rgb", "rgba");
    E.ctx.lineWidth = lerp(0.5, 2, i / trail.length);
    E.ctx.beginPath();
    E.ctx.moveTo((a.x + 0.5) * cell, (a.y + 0.5) * cell);
    E.ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
    E.ctx.stroke();
  }
}

function drawUAV(px, py, cell, battery, scanRange, t, trail) {
  const color = "rgb(130,200,255)";
  drawTrail(trail, cell, color);

  E.ctx.save();
  E.ctx.beginPath();
  E.ctx.arc(px, py, scanRange * cell, 0, Math.PI * 2);
  E.ctx.strokeStyle = "rgba(130,200,255,0.25)";
  E.ctx.setLineDash([4, 4]);
  E.ctx.lineDashOffset = -t * 10;
  E.ctx.lineWidth = 1;
  E.ctx.stroke();
  E.ctx.setLineDash([]);
  E.ctx.fillStyle = "rgba(130,200,255,0.04)";
  E.ctx.fill();
  E.ctx.restore();

  E.ctx.save();
  E.ctx.translate(px, py);
  E.ctx.rotate(t * 8);
  E.ctx.strokeStyle = "#82c8ff";
  E.ctx.lineWidth = 1.5;
  E.ctx.shadowBlur = 10;
  E.ctx.shadowColor = "#82c8ff";
  const arm = Math.min(8, cell * 0.4);
  const rotor = Math.max(2, cell * 0.13);
  for (let i = 0; i < 4; i += 1) {
    E.ctx.rotate(Math.PI / 2);
    E.ctx.beginPath();
    E.ctx.moveTo(0, 0);
    E.ctx.lineTo(arm, 0);
    E.ctx.stroke();
    E.ctx.beginPath();
    E.ctx.arc(arm + rotor * 0.3, 0, rotor, 0, Math.PI * 2);
    E.ctx.stroke();
  }
  E.ctx.shadowBlur = 0;
  E.ctx.beginPath();
  E.ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  E.ctx.fillStyle = "#82c8ff";
  E.ctx.fill();
  E.ctx.restore();

  E.ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : "#82c8ff";
  E.ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  E.ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawUGV(px, py, cell, battery, t, trail) {
  const color = "rgb(93,255,180)";

  if (trail && trail.length > 1) {
    E.ctx.save();
    E.ctx.setLineDash([3, 5]);
    E.ctx.lineDashOffset = -t * 8;
    for (let i = 1; i < trail.length; i += 1) {
      const a = trail[i - 1];
      const b = trail[i];
      const alpha = (i / trail.length) * 0.45;
      E.ctx.strokeStyle = `rgba(57,255,20,${alpha})`;
      E.ctx.lineWidth = lerp(0.5, 1.5, i / trail.length);
      E.ctx.beginPath();
      E.ctx.moveTo((a.x + 0.5) * cell, (a.y + 0.5) * cell);
      E.ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
      E.ctx.stroke();
    }
    E.ctx.restore();
  }

  E.ctx.save();
  E.ctx.shadowBlur = 8;
  E.ctx.shadowColor = color;
  const body = cell * 0.5;
  const half = body / 2;
  E.ctx.strokeStyle = "#5dffb4";
  E.ctx.lineWidth = 1.2;
  E.ctx.strokeRect(px - half, py - half, body, body);
  E.ctx.fillStyle = "rgba(93,255,180,0.18)";
  E.ctx.fillRect(px - half, py - half, body, body);
  E.ctx.fillStyle = "#5dffb4";
  const trackW = Math.max(2, body * 0.18);
  E.ctx.fillRect(px - half - trackW - 1, py - half + 1, trackW, body - 2);
  E.ctx.fillRect(px + half + 1, py - half + 1, trackW, body - 2);
  E.ctx.beginPath();
  E.ctx.arc(px, py, Math.max(1.5, body * 0.16), 0, Math.PI * 2);
  E.ctx.fill();
  E.ctx.restore();

  E.ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : "#5dffb4";
  E.ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  E.ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawBalloon(px, py, cell, battery, commCells, t) {
  const baseR = Math.max(6, cell * 0.42);
  const drift = Math.sin(t * 0.6) * cell * 0.15;
  const cy = py + drift;
  const commR = (commCells || 10) * cell;
  const pulse = 1 + Math.sin(t * 1.2) * 0.04;

  // comm coverage ring
  E.ctx.save();
  E.ctx.beginPath();
  E.ctx.arc(px, cy, commR * pulse, 0, Math.PI * 2);
  E.ctx.fillStyle = "rgba(200,180,255,0.05)";
  E.ctx.fill();
  E.ctx.strokeStyle = "rgba(200,180,255,0.28)";
  E.ctx.setLineDash([6, 6]);
  E.ctx.lineDashOffset = -t * 8;
  E.ctx.lineWidth = 1;
  E.ctx.stroke();
  E.ctx.setLineDash([]);
  E.ctx.restore();

  // sphere
  E.ctx.save();
  E.ctx.shadowBlur = 12;
  E.ctx.shadowColor = "#c8b4ff";
  E.ctx.beginPath();
  E.ctx.arc(px, cy - baseR * 0.18, baseR, 0, Math.PI * 2);
  E.ctx.fillStyle = "rgba(200,180,255,0.75)";
  E.ctx.fill();
  E.ctx.strokeStyle = "#c8b4ff";
  E.ctx.lineWidth = 1.2;
  E.ctx.stroke();
  E.ctx.shadowBlur = 0;

  // gondola
  E.ctx.fillStyle = "#c8b4ff";
  const gw = baseR * 0.85;
  const gh = baseR * 0.45;
  E.ctx.fillRect(px - gw / 2, cy + baseR * 0.45, gw, gh);

  // tether ropes
  E.ctx.strokeStyle = "rgba(200,180,255,0.6)";
  E.ctx.lineWidth = 0.8;
  E.ctx.beginPath();
  E.ctx.moveTo(px - gw / 4, cy + baseR * 0.45);
  E.ctx.lineTo(px - baseR * 0.45, cy + baseR * 0.18);
  E.ctx.moveTo(px + gw / 4, cy + baseR * 0.45);
  E.ctx.lineTo(px + baseR * 0.45, cy + baseR * 0.18);
  E.ctx.stroke();
  E.ctx.restore();

  E.ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : "#c8b4ff";
  E.ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  E.ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawArmored(px, py, cell, battery, t, trail) {
  const color = "rgb(255,140,60)";

  // trail
  if (trail && trail.length > 1) {
    E.ctx.save();
    for (let i = 1; i < trail.length; i += 1) {
      const a = trail[i - 1];
      const b = trail[i];
      const alpha = (i / trail.length) * 0.45;
      E.ctx.strokeStyle = `rgba(255,140,60,${alpha})`;
      E.ctx.lineWidth = lerp(0.5, 2, i / trail.length);
      E.ctx.beginPath();
      E.ctx.moveTo((a.x + 0.5) * cell, (a.y + 0.5) * cell);
      E.ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
      E.ctx.stroke();
    }
    E.ctx.restore();
  }

  // hex-ish armored hull
  E.ctx.save();
  E.ctx.shadowBlur = 9;
  E.ctx.shadowColor = color;
  const body = cell * 0.6;
  const half = body / 2;
  const slope = body * 0.28;
  E.ctx.beginPath();
  E.ctx.moveTo(px - half + slope, py - half);
  E.ctx.lineTo(px + half - slope, py - half);
  E.ctx.lineTo(px + half, py - half + slope);
  E.ctx.lineTo(px + half, py + half - slope);
  E.ctx.lineTo(px + half - slope, py + half);
  E.ctx.lineTo(px - half + slope, py + half);
  E.ctx.lineTo(px - half, py + half - slope);
  E.ctx.lineTo(px - half, py - half + slope);
  E.ctx.closePath();
  E.ctx.fillStyle = "rgba(255,140,60,0.18)";
  E.ctx.fill();
  E.ctx.strokeStyle = color;
  E.ctx.lineWidth = 1.3;
  E.ctx.stroke();

  // tracks
  const trackW = Math.max(2, body * 0.16);
  E.ctx.fillStyle = color;
  E.ctx.fillRect(px - half - trackW - 1, py - half + slope, trackW, body - slope * 2);
  E.ctx.fillRect(px + half + 1, py - half + slope, trackW, body - slope * 2);

  // forward headlight wedge
  const wedge = body * 0.35;
  E.ctx.beginPath();
  E.ctx.moveTo(px, py - half - 1);
  E.ctx.lineTo(px - wedge * 0.5, py - half - wedge);
  E.ctx.lineTo(px + wedge * 0.5, py - half - wedge);
  E.ctx.closePath();
  E.ctx.fillStyle = "rgba(255,200,140,0.25)";
  E.ctx.fill();

  // turret dot
  E.ctx.beginPath();
  E.ctx.arc(px, py, Math.max(1.5, body * 0.13), 0, Math.PI * 2);
  E.ctx.fillStyle = color;
  E.ctx.fill();
  E.ctx.shadowBlur = 0;
  E.ctx.restore();

  E.ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : color;
  E.ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  E.ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawAgentLabel(id, px, py, color) {
  E.ctx.fillStyle = color;
  E.ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  E.ctx.shadowBlur = 4;
  E.ctx.shadowColor = color;
  E.ctx.fillText(id, px - 14, py + 18);
  E.ctx.shadowBlur = 0;
}
