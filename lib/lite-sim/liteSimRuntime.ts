// @ts-nocheck
// Ported from main app.js; gradual typing would be a large follow-up.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export function initLiteSim(): () => void {

const canvas = document.querySelector("#simCanvas");
if (!canvas) {
  return () => {};
}
const ctx = canvas.getContext("2d");
if (!ctx) {
  return () => {};
}
const tickLabel = document.querySelector("#tickLabel");
const rescuedCount = document.querySelector("#rescuedCount");
const priorityList = document.querySelector("#priorityList");
const agentList = document.querySelector("#agentList");
const briefText = document.querySelector("#briefText");
const missionJson = document.querySelector("#missionJson");
const stepBtn = document.querySelector("#stepBtn");
const autoBtn = document.querySelector("#autoBtn");
const resetBtn = document.querySelector("#resetBtn");
if (!stepBtn || !autoBtn || !resetBtn) {
  return () => {};
}
const survivalChart = document.querySelector("#survivalChart");
const chartCtx = survivalChart ? survivalChart.getContext("2d") : null;
const survivalHistory = [];

const povCols = Array.from(document.querySelectorAll(".map-pov-col"));
const DEFAULT_POV_AGENTS = ["Drone-1"];
const agentSelectorHost = document.querySelector("#agentSelector");
const povSubEl = document.querySelector("[data-pov-sub]");
const agentCardEls = new Map();

const world = {
  scene: null,
  agentMeshes: new Map(),
  victimMeshes: new Map(),
  blockadeMeshes: new Map(),
  riskMeshes: new Map(),
  baseMesh: null,
  groundGrid: null,
  initialized: false
};

// Per-viewport state: { col, canvas, renderer, camera, selectedId, smoothPos, smoothLook, smoothHdg, smoothVel, hud }
const povs = [];

let initialScenario;
let state;
let timer = null;
let plan = null;
let rafId = null;
let lastTickAt = 0;
const T0 = performance.now();
const trails = new Map();
const seenCells = new Set<string>();
const TRAIL_LEN = 10;
const MS_PER_TICK = 900;
const MAX_EVENT_LOG = 20;
let typewriterTimer = null;
const TOAST_STYLES = {
  rescued:          { color: "#39ff14", bg: "rgba(0,60,0,0.92)" },
  victim_dead:      { color: "#ff4444", bg: "rgba(60,0,0,0.92)" },
  blockade_cleared: { color: "#ffe44d", bg: "rgba(60,50,0,0.92)" },
  relay_deployed:   { color: "#c8b4ff", bg: "rgba(40,20,80,0.92)" },
  default:          { color: "#00bfff", bg: "rgba(0,20,50,0.92)" }
};
function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

fetch("/lite/scenario_canvas_lite.json")
  .then((response) => response.json())
  .then((scenario) => {
    initialScenario = scenario;
    init3D(scenario);
    reset();
  });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reset() {
  state = clone(initialScenario);
  state.timestep = 0;
  state.rescued = 0;
  lastTickAt = performance.now();
  trails.clear();
  seenCells.clear();
  for (const agent of state.agents) {
    agent.prevLocation = [...agent.location];
    trails.set(agent.id, [{ x: agent.location[0], y: agent.location[1] }]);
  }
  survivalHistory.length = 0;
  recordSurvivalSample();
  const log = document.getElementById("eventLog");
  if (log) log.innerHTML = "";
  plan = generatePlan();
  stopAuto();
  renderOnce();
  startRafLoop();
}

function recordSurvivalSample() {
  const total = state.victims.length || 1;
  const alive = state.victims.filter((v) => v.status !== "dead").length;
  const rescued = state.victims.filter((v) => v.status === "rescued").length;
  survivalHistory.push({
    t: state.timestep,
    alive: alive / total,
    rescued: rescued / total
  });
}

function step() {
  state.timestep += 1;
  lastTickAt = performance.now();
  for (const agent of state.agents) {
    agent.prevLocation = [...agent.location];
  }
  const prevVictimStatus = new Map(state.victims.map((v) => [v.id, v.status]));
  const prevBlockadeStatus = new Map(state.map.blocked_cells.map((b) => [b.id, b.status]));
  const prevRescued = state.rescued;

  updateVictims();
  updateBlockades();
  plan = generatePlan();
  executeActions(plan.mission_plan);
  for (const agent of state.agents) {
    if (!trails.has(agent.id)) trails.set(agent.id, []);
    const trail = trails.get(agent.id);
    trail.push({ x: agent.location[0], y: agent.location[1] });
    if (trail.length > TRAIL_LEN) trail.shift();
  }
  plan = generatePlan();

  for (const victim of state.victims) {
    const before = prevVictimStatus.get(victim.id);
    if (before !== "rescued" && victim.status === "rescued") {
      emitToast("rescued", `${victim.id} rescued`);
    } else if (before !== "dead" && victim.status === "dead") {
      emitToast("victim_dead", `${victim.id} lost`);
    }
  }
  for (const blockade of state.map.blocked_cells) {
    if (prevBlockadeStatus.get(blockade.id) !== "cleared" && blockade.status === "cleared") {
      emitToast("blockade_cleared", `${blockade.id} cleared`);
    }
  }
  if (state.rescued !== prevRescued) {
    popCounter(rescuedCount, state.rescued);
  }
  recordSurvivalSample();
  renderOnce();
}

function startRafLoop() {
  if (rafId !== null) return;
  const tick = (now) => {
    const t = (now - T0) / 1000;
    drawMap(t);
    update3D(t);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function updateVictims() {
  for (const victim of state.victims) {
    if (victim.status === "trapped" || victim.status === "unknown") {
      victim.hp = Math.max(0, victim.hp - victim.damage_per_step);
      if (victim.hp === 0) victim.status = "dead";
    }
  }
}

function updateBlockades() {
  for (const blockade of state.map.blocked_cells) {
    if (blockade.clear_progress >= blockade.repair_cost) blockade.status = "cleared";
  }
}

function executeActions(actions) {
  for (const action of actions) {
    const agent = state.agents.find((item) => item.id === action.agent);
    if (!agent) continue;

    if (action.task === "clear_blockade") {
      const blockade = state.map.blocked_cells.find((item) => item.id === action.target);
      if (blockade && blockade.status === "blocked") {
        blockade.clear_progress = Math.min(blockade.repair_cost, blockade.clear_progress + (agent.clear_rate || 0));
        if (blockade.clear_progress >= blockade.repair_cost) blockade.status = "cleared";
      }
    }

    if (action.target?.startsWith("V")) {
      const victim = state.victims.find((item) => item.id === action.target);
      moveAgentToward(agent, victim.location);
      if (agent.type === "ground_rescue" && victim.status === "trapped" && sameCell(agent.location, victim.location)) {
        victim.status = "rescued";
        state.rescued += 1;
      }
    } else if (action.target === "Relay-R1") {
      moveAgentToward(agent, [14, 7]);
    } else if (action.target?.startsWith("K")) {
      const blockade = state.map.blocked_cells.find((item) => item.id === action.target);
      moveAgentToward(agent, blockade.location);
    }

    agent.battery = Math.max(0, agent.battery - (agent.type === "drone" ? 2 : 1));
  }
}

function moveAgentToward(agent, target) {
  if (!target) return;
  const [x, y] = agent.location;
  const dx = target[0] - x;
  const dy = target[1] - y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const speed = agent.speed || 1;
  const nx = x + Math.sign(dx) * Math.min(Math.abs(dx), speed / steps);
  const ny = y + Math.sign(dy) * Math.min(Math.abs(dy), speed / steps);
  agent.location = [roundCoord(nx), roundCoord(ny)];
}

function roundCoord(value) {
  return Math.round(value * 10) / 10;
}

function sameCell(a, b) {
  return Math.round(a[0]) === b[0] && Math.round(a[1]) === b[1];
}

function generatePlan() {
  const candidates = rankVictims();
  const top = candidates[0];
  const v2 = candidates.find((candidate) => candidate.id === "V2") || candidates[1];
  const criticalBlockade = state.map.blocked_cells.find((blockade) => blockade.status === "blocked");
  const needsRelay = top && top.communication_status !== "available" && top.score > 0.62;

  const missionPlan = [];
  if (top) {
    missionPlan.push({
      agent: "Drone-1",
      task: "aerial_confirmation",
      target: top.id,
      safety_note: "Keep flight path above blocked roads and avoid prolonged hover over collapse-risk cells."
    });
  }
  if (needsRelay) {
    missionPlan.push({
      agent: "Drone-2",
      task: "deploy_relay",
      target: "Relay-R1",
      safety_note: "Hold relay coverage between base and the weak communication zone."
    });
  }
  if (v2) {
    missionPlan.push({
      agent: "UGV-1",
      task: "vibration_audio_verification",
      target: v2.id,
      safety_note: "Use the safer corridor and do not enter blocked or extreme collapse-risk cells."
    });
  }
  if (criticalBlockade) {
    missionPlan.push({
      agent: "UGV-2",
      task: "clear_blockade",
      target: criticalBlockade.id,
      safety_note: "Clear one blockade at a time; parallel clearing is not counted as extra benefit."
    });
  }

  return {
    commander_briefing: makeBrief(candidates, needsRelay, criticalBlockade),
    priority_order: candidates.map((candidate) => candidate.id),
    mission_plan: missionPlan,
    human_confirmation_required: [
      top ? `Approve aerial confirmation of ${top.id}.` : "No active victim needs confirmation.",
      needsRelay ? "Confirm relay drone deployment before high-risk close approach." : "Relay not required for the current top target."
    ]
  };
}

function rankVictims() {
  const activeVictims = state.victims.filter((victim) => victim.status !== "dead" && victim.status !== "rescued");
  const confirmedVictims = activeVictims.filter((victim) => victim.status === "trapped");
  const survivalBaseline = confirmedVictims.length ? confirmedVictims : activeVictims;
  const maxSurvival = Math.max(...survivalBaseline.map(estimatedSurvivalSteps), 1);

  return activeVictims
    .map((victim) => {
      const bestAgent = chooseBestAgent(victim);
      const distance = manhattan(state.map.base, victim.location);
      const normalizedDistance = Math.min(1, distance / 40);
      const accessDifficulty = bestAgent.pathRisk + (bestAgent.blocked ? 0.35 : 0);
      const energyFeasible = bestAgent.agent.battery - distance * 0.8 >= 15 ? 1 : 0;
      const score =
        0.35 * urgency(victim, maxSurvival) +
        0.25 * lifeSignalConfidence(victim) +
        0.15 * (1 - clamp(accessDifficulty, 0, 1)) +
        0.15 * (1 - normalizedDistance) +
        0.1 * energyFeasible;

      return {
        id: victim.id,
        score: round(score),
        hp: Math.round(victim.hp),
        survival_steps: round(estimatedSurvivalSteps(victim)),
        life_signal_confidence: round(lifeSignalConfidence(victim)),
        best_agent: bestAgent.agent.id,
        communication_status: communicationStatus(victim.location),
        status: victim.status
      };
    })
    .sort((a, b) => b.score - a.score);
}

function chooseBestAgent(victim) {
  const options = state.agents
    .filter((agent) => agent.role !== "relay" && agent.role !== "clear_blockade")
    .map((agent) => ({
      agent,
      pathRisk: locationRisk(victim.location, agent.type),
      blocked: agent.type !== "drone" && isBlockedNear(victim.location)
    }));

  return options.sort((a, b) => a.pathRisk - b.pathRisk)[0];
}

function lifeSignalConfidence(victim) {
  return 0.4 * victim.thermal_signal + 0.3 * victim.audio_signal + 0.3 * victim.vibration_signal;
}

function estimatedSurvivalSteps(victim) {
  return victim.damage_per_step <= 0 ? Infinity : victim.hp / victim.damage_per_step;
}

function urgency(victim, maxSurvivalSteps) {
  return clamp(1 - estimatedSurvivalSteps(victim) / maxSurvivalSteps, 0, 1);
}

function locationRisk(location, agentType) {
  return state.map.risk_zones.reduce((risk, zone) => {
    if (distance(location, zone.center) > zone.radius) return risk;
    if (agentType !== "drone" && zone.type === "fire") return risk + zone.risk;
    return risk + zone.risk * 0.65;
  }, 0);
}

function isBlockedNear(location) {
  return state.map.blocked_cells.some((blockade) => blockade.status === "blocked" && manhattan(blockade.location, location) <= 3);
}

function communicationStatus(location) {
  const baseDistance = distance(location, state.map.base);
  const inDeadZone = state.map.communication_dead_zones.some((zone) => distance(location, zone.center) <= zone.radius);
  if (baseDistance <= state.communication.base_range && !inDeadZone) return "available";
  if (baseDistance <= state.communication.base_range || inDeadZone) return "weak";
  return "offline";
}

function makeBrief(candidates, needsRelay, blockade) {
  if (!candidates.length) return "All known victim sites are resolved. Maintain perimeter scanning and prepare extraction reports.";
  const top = candidates[0];
  const relayText = needsRelay ? " Because communication is weak, Drone-2 should establish Relay-R1 before close approach." : "";
  const blockadeText = blockade ? ` UGV-2 should continue clearing ${blockade.id} to open the ground corridor.` : " Ground corridors are currently open enough for the next move.";
  return `${top.id} is the current priority because it combines a short survival window, strong life-signal confidence, and acceptable access cost. Drone-1 should confirm the site from above while UGV-1 verifies the safest reachable target.${relayText}${blockadeText}`;
}

function renderOnce() {
  renderPanels();
  drawMap((performance.now() - T0) / 1000);
}

function drawMap(t) {
  if (!state) return;
  const [cols, rows] = state.map.size;
  const cell = canvas.width / cols;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBackground();
  drawTerrain(cell);
  drawGridLines(cols, rows, cell);
  drawRoads(cell, t);
  drawBuildings(cell);
  drawCommunication(cell, t);
  drawRiskZones(cell, t);
  drawBuildingDamage(cell, t);
  drawBlockades(cell);
  drawVictims(cell, t);
  drawBase(cell);
  drawAgents(cell, t);
  drawFogOfWar(cols, rows, cell);
  drawVignette();
}

function updateSeenCells(cols, rows) {
  for (const agent of state.agents) {
    const [ax, ay] = agent.location;
    const r = Math.max(1, agent.perception_range || 3);
    const r2 = r * r;
    const minX = Math.max(0, Math.floor(ax - r));
    const maxX = Math.min(cols - 1, Math.ceil(ax + r));
    const minY = Math.max(0, Math.floor(ay - r));
    const maxY = Math.min(rows - 1, Math.ceil(ay + r));
    for (let cy = minY; cy <= maxY; cy += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const dx = cx - ax;
        const dy = cy - ay;
        if (dx * dx + dy * dy <= r2) seenCells.add(`${cx},${cy}`);
      }
    }
  }
}

function drawFogOfWar(cols, rows, cell) {
  updateSeenCells(cols, rows);
  ctx.save();
  ctx.fillStyle = "rgba(6,10,20,0.55)";
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      if (!seenCells.has(`${cx},${cy}`)) {
        ctx.fillRect(cx * cell, cy * cell, cell, cell);
      }
    }
  }
  ctx.restore();
}

function drawVignette() {
  const w = canvas.width;
  const h = canvas.height;
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.7, "rgba(0,0,0,0.25)");
  grad.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

const BUILDING_KINDS = {
  apartment: { base: "#2c3a52", roof: "#3d4e6c", trim: "#5b7196", windowOn: "rgba(255,210,120,0.85)", windowOff: "rgba(120,140,180,0.18)", litChance: 0.55 },
  civic:     { base: "#384455", roof: "#4a5970", trim: "#728aae", windowOn: "rgba(180,220,255,0.78)", windowOff: "rgba(140,160,190,0.15)", litChance: 0.35 },
  lowrise:   { base: "#4a3a30", roof: "#5d4a3c", trim: "#7c6452", windowOn: "rgba(255,180,90,0.7)",  windowOff: "rgba(150,120,90,0.18)", litChance: 0.25 },
  warehouse: { base: "#2f3438", roof: "#3f464b", trim: "#5a636a", windowOn: "rgba(160,200,230,0.55)", windowOff: "rgba(110,120,130,0.18)", litChance: 0.15 }
};

function buildingSeed(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function drawBuildings(cell) {
  if (!state.map.buildings) return;
  for (const b of state.map.buildings) {
    const [bx, by, bw, bh] = b.footprint;
    const palette = BUILDING_KINDS[b.kind] || BUILDING_KINDS.lowrise;
    const x = bx * cell;
    const y = by * cell;
    const w = bw * cell;
    const h = bh * cell;
    const inset = Math.max(1, cell * 0.08);

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x + inset * 1.5, y + inset * 1.5, w - inset, h - inset);

    ctx.fillStyle = palette.base;
    ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);

    const roofInset = inset * 2.2;
    ctx.fillStyle = palette.roof;
    ctx.fillRect(x + roofInset, y + roofInset, w - roofInset * 2, h - roofInset * 2);

    ctx.strokeStyle = palette.trim;
    ctx.lineWidth = 0.75;
    ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, w - inset * 2 - 1, h - inset * 2 - 1);

    const seed = buildingSeed(b.id);
    if (b.kind === "warehouse") {
      ctx.fillStyle = "rgba(120,140,160,0.35)";
      const stripeStep = cell * 0.55;
      for (let sx = x + roofInset + stripeStep * 0.4; sx < x + w - roofInset; sx += stripeStep) {
        ctx.fillRect(sx, y + roofInset + 2, stripeStep * 0.45, h - roofInset * 2 - 4);
      }
    } else {
      const winCols = Math.max(1, Math.floor(bw * 2));
      const winRows = Math.max(1, Math.floor(bh * 2));
      const cellW = (w - inset * 4) / winCols;
      const cellH = (h - inset * 4) / winRows;
      const winW = Math.max(1, cellW * 0.55);
      const winH = Math.max(1, cellH * 0.5);
      for (let cy = 0; cy < winRows; cy += 1) {
        for (let cx = 0; cx < winCols; cx += 1) {
          const bit = ((seed >>> ((cy * winCols + cx) % 31)) & 1) === 1;
          const lit = bit && (((seed * (cx + 1) * (cy + 3)) >>> 0) % 1000) / 1000 < palette.litChance;
          ctx.fillStyle = lit ? palette.windowOn : palette.windowOff;
          const wx = x + inset * 2 + cx * cellW + (cellW - winW) / 2;
          const wy = y + inset * 2 + cy * cellH + (cellH - winH) / 2;
          ctx.fillRect(wx, wy, winW, winH);
        }
      }
    }
    ctx.restore();
  }
}

function drawBackground() {
  ctx.fillStyle = "#1a2433";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGridLines(cols, rows, cell) {
  ctx.strokeStyle = "rgba(120, 180, 230, 0.16)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= cols; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, canvas.height);
    ctx.stroke();
  }
  for (let i = 0; i <= rows; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(canvas.width, i * cell);
    ctx.stroke();
  }
}

const TERRAIN_KINDS = {
  plaza:  { base: "#3a4250", accent: "rgba(90,105,125,0.35)" },
  grass:  { base: "#2c4a2a", accent: "rgba(60,90,55,0.55)" },
  water:  { base: "#1c3550", accent: "rgba(120,180,220,0.18)" },
  rubble: { base: "#3d3a35", accent: "rgba(80,72,62,0.85)" }
};

function drawTerrain(cell) {
  if (!state.map.terrain) return;
  for (const patch of state.map.terrain) {
    const [px, py, pw, ph] = patch.footprint;
    const palette = TERRAIN_KINDS[patch.kind] || TERRAIN_KINDS.plaza;
    const x = px * cell;
    const y = py * cell;
    const w = pw * cell;
    const h = ph * cell;

    ctx.fillStyle = palette.base;
    ctx.fillRect(x, y, w, h);

    if (patch.kind === "grass") {
      ctx.fillStyle = palette.accent;
      const step = Math.max(3, cell * 0.45);
      let seed = (px * 73856093) ^ (py * 19349663);
      for (let yy = y + step / 2; yy < y + h; yy += step) {
        for (let xx = x + step / 2; xx < x + w; xx += step) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const jx = ((seed & 0xff) / 255 - 0.5) * step * 0.4;
          const jy = (((seed >>> 8) & 0xff) / 255 - 0.5) * step * 0.4;
          ctx.fillRect(xx + jx, yy + jy, 1.2, 1.2);
        }
      }
    } else if (patch.kind === "water") {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 0.6;
      for (let yy = y + cell * 0.4; yy < y + h; yy += cell * 0.6) {
        ctx.beginPath();
        ctx.moveTo(x + cell * 0.15, yy);
        ctx.bezierCurveTo(x + w * 0.35, yy - cell * 0.18, x + w * 0.65, yy + cell * 0.18, x + w - cell * 0.15, yy);
        ctx.stroke();
      }
    } else if (patch.kind === "rubble") {
      let seed = (px * 374761393) ^ (py * 668265263);
      for (let i = 0; i < pw * ph * 14; i += 1) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const rx = x + ((seed & 0xffff) / 0xffff) * w;
        const ry = y + (((seed >>> 16) & 0xffff) / 0xffff) * h;
        const sz = 1 + ((seed >>> 4) & 3);
        ctx.fillStyle = palette.accent;
        ctx.fillRect(rx, ry, sz, sz);
      }
    } else if (patch.kind === "plaza") {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 0.4;
      for (let xx = x + cell; xx < x + w; xx += cell) {
        ctx.beginPath();
        ctx.moveTo(xx, y);
        ctx.lineTo(xx, y + h);
        ctx.stroke();
      }
      for (let yy = y + cell; yy < y + h; yy += cell) {
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy);
        ctx.stroke();
      }
    }
  }
}

function drawRoads(cell, t) {
  if (!state.map.roads) return;
  const asphalt = "#1a1f27";
  const curb = "rgba(70,82,98,0.6)";
  const mainCenter = "rgba(255,228,77,0.85)";
  const sideCenter = "rgba(180,190,205,0.45)";
  const widthMain = cell * 0.78;
  const widthSide = cell * 0.62;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const road of state.map.roads) {
    const w = road.kind === "main" ? widthMain : widthSide;
    ctx.strokeStyle = asphalt;
    ctx.lineWidth = w;
    ctx.beginPath();
    const pts = road.points;
    ctx.moveTo((pts[0][0] + 0.5) * cell, (pts[0][1] + 0.5) * cell);
    for (let i = 1; i < pts.length; i += 1) {
      ctx.lineTo((pts[i][0] + 0.5) * cell, (pts[i][1] + 0.5) * cell);
    }
    ctx.stroke();

    ctx.strokeStyle = curb;
    ctx.lineWidth = Math.max(0.5, w * 0.06);
    ctx.stroke();
  }

  for (const road of state.map.roads) {
    const pts = road.points;
    if (road.kind === "main") {
      ctx.strokeStyle = mainCenter;
      ctx.lineWidth = Math.max(1, cell * 0.07);
      ctx.setLineDash([cell * 0.5, cell * 0.4]);
      ctx.lineDashOffset = -t * 4;
    } else {
      ctx.strokeStyle = sideCenter;
      ctx.lineWidth = Math.max(0.5, cell * 0.04);
      ctx.setLineDash([cell * 0.25, cell * 0.35]);
      ctx.lineDashOffset = 0;
    }
    ctx.beginPath();
    ctx.moveTo((pts[0][0] + 0.5) * cell, (pts[0][1] + 0.5) * cell);
    for (let i = 1; i < pts.length; i += 1) {
      ctx.lineTo((pts[i][0] + 0.5) * cell, (pts[i][1] + 0.5) * cell);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function pointInZone(cx, cy, zone) {
  const dx = cx - zone.center[0];
  const dy = cy - zone.center[1];
  return dx * dx + dy * dy <= zone.radius * zone.radius;
}

function drawBuildingDamage(cell, t) {
  if (!state.map.buildings || !state.map.risk_zones) return;
  const collapseZones = state.map.risk_zones.filter((z) => z.type === "collapse");
  const fireZones = state.map.risk_zones.filter((z) => z.type === "fire");
  if (!collapseZones.length && !fireZones.length) return;

  for (const b of state.map.buildings) {
    const [bx, by, bw, bh] = b.footprint;
    const ccx = bx + bw / 2;
    const ccy = by + bh / 2;
    const x = bx * cell;
    const y = by * cell;
    const w = bw * cell;
    const h = bh * cell;
    const inCollapse = collapseZones.some((z) => pointInZone(ccx, ccy, z));
    const inFire = fireZones.some((z) => pointInZone(ccx, ccy, z));
    if (!inCollapse && !inFire) continue;

    let seed = buildingSeed(b.id);
    const rand = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed & 0xffff) / 0xffff;
    };

    if (inCollapse) {
      ctx.save();
      ctx.strokeStyle = "rgba(15,18,25,0.9)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i += 1) {
        let sx = x + rand() * w;
        let sy = y + rand() * h;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (let j = 0; j < 4; j += 1) {
          sx += (rand() - 0.5) * w * 0.35;
          sy += (rand() - 0.5) * h * 0.35;
          ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(70,62,52,0.95)";
      for (let i = 0; i < 8; i += 1) {
        const cxp = x + rand() * w;
        const cyp = y + rand() * h;
        const sz = 1.5 + rand() * 2.5;
        ctx.fillRect(cxp, cyp, sz, sz);
      }
      ctx.restore();
    }

    if (inFire) {
      ctx.save();
      const plumes = 2 + (b.footprint[2] >= 3 ? 1 : 0);
      for (let i = 0; i < plumes; i += 1) {
        const baseX = x + (0.25 + (i / plumes) * 0.5 + rand() * 0.1) * w;
        const baseY = y + h * 0.15;
        const phase = i * 1.7 + rand() * 6;
        for (let p = 0; p < 4; p += 1) {
          const tt = ((t * 0.9 + phase + p * 0.7) % 3);
          const alpha = Math.max(0, 0.42 - tt * 0.12);
          const rise = tt * cell * 1.1;
          const drift = Math.sin(t * 1.2 + p + i) * cell * 0.35;
          const size = cell * (0.45 + tt * 0.3);
          ctx.fillStyle = `rgba(75,68,62,${alpha})`;
          ctx.beginPath();
          ctx.arc(baseX + drift, baseY - rise, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (let i = 0; i < 5; i += 1) {
        const phase = rand() * 6;
        const tt = ((t * 2 + phase) % 2);
        const alpha = Math.max(0, 0.85 - tt * 0.45);
        const ex = x + rand() * w;
        const ey = y + h * 0.2 - tt * cell * 0.9;
        ctx.fillStyle = `rgba(255,${130 + Math.floor(tt * 60)},40,${alpha})`;
        ctx.fillRect(ex, ey, 1.6, 1.6);
      }
      ctx.restore();
    }
  }
}

function drawCommunication(cell, t) {
  for (const zone of state.map.communication_dead_zones) {
    const px = zone.center[0] * cell;
    const py = zone.center[1] * cell;
    const r = zone.radius * cell;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#334466";
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#88aacc";
    const seedBase = zone.id ? zone.id.charCodeAt(0) : 7;
    for (let i = 0; i < 60; i += 1) {
      const seed = seedBase + i;
      const angle = (Math.sin(seed * 12.9898) * 0.5 + 0.5) * Math.PI * 2 + t * 0.4;
      const radial = ((Math.sin(seed * 78.233) * 0.5 + 0.5 + t * 0.05 * (i % 3 + 1)) % 1) * r;
      const dx = px + radial * Math.cos(angle);
      const dy = py + radial * Math.sin(angle);
      ctx.fillRect(dx - 0.75, dy - 0.75, 1.5, 1.5);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(136,170,204,0.55)";
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -t * 12;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const relay = state.agents.find((agent) => agent.id === "Drone-2");
  if (relay && distance(relay.location, [14, 7]) <= 1.5) {
    const px = relay.location[0] * cell;
    const py = relay.location[1] * cell;
    const r = state.communication.relay_range * cell;
    const pulse = 1 + Math.sin(t * 1.5) * 0.04;
    ctx.fillStyle = "rgba(200, 180, 255, 0.10)";
    ctx.beginPath();
    ctx.arc(px, py, r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(200, 180, 255, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawRiskZones(cell, t) {
  for (const zone of state.map.risk_zones) {
    const px = zone.center[0] * cell;
    const py = zone.center[1] * cell;
    const r = zone.radius * cell;
    const isFire = zone.type === "fire";
    const baseColor = isFire ? "255,60,0" : "168,135,255";
    const alpha = 0.14 + Math.sin(t * 1.4) * 0.06;

    const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, `rgba(${baseColor},${alpha * 2})`);
    grad.addColorStop(1, `rgba(${baseColor},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(${baseColor},${alpha * 3})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = `rgba(${isFire ? "255,80,0" : "200,170,255"},0.8)`;
    ctx.font = "9px 'Courier New', monospace";
    const label = zone.type.toUpperCase();
    ctx.fillText(label, px - label.length * 2.7, py + 3);
  }
}

function drawBlockades(cell) {
  for (const blockade of state.map.blocked_cells) {
    const [x, y] = blockade.location;
    if (blockade.status === "cleared") {
      ctx.fillStyle = "rgba(57,255,20,0.08)";
      ctx.fillRect(x * cell, y * cell, cell, cell);
      continue;
    }
    ctx.fillStyle = "rgba(139,69,19,0.5)";
    ctx.fillRect(x * cell, y * cell, cell, cell);
    ctx.strokeStyle = "#8b4513";
    ctx.lineWidth = 1;
    ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    ctx.fillStyle = "#a0522d";
    ctx.font = "9px 'Courier New', monospace";
    ctx.fillText("BLK", x * cell + 2, y * cell + cell / 2 + 3);
    const progress = blockade.clear_progress / blockade.repair_cost;
    ctx.fillStyle = "#ffe44d";
    ctx.fillRect(x * cell + 3, y * cell + cell - 5, (cell - 6) * progress, 2);
  }
}

function drawVictims(cell, t) {
  for (const victim of state.victims) {
    const [x, y] = victim.location;
    const px = (x + 0.5) * cell;
    const py = (y + 0.5) * cell;
    const buriedness = victim.buriedness || 0;
    const tier = buriedness >= 55 ? "buried" : buriedness >= 30 ? "sitting" : "standing";
    const status = victim.status;
    const color = status === "rescued" ? "#39ff14"
      : status === "dead" ? "#555555"
      : status === "unknown" ? "#c8b4ff"
      : "#ff6666";

    if (status === "trapped" || status === "unknown") {
      const halo = 0.5 + 0.5 * (Math.sin(t * 3) * 0.5 + 0.5);
      ctx.save();
      ctx.globalAlpha = (tier === "buried" ? 0.10 : 0.18) * halo;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, cell * (tier === "buried" ? 0.42 : 0.55), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (tier === "buried" && status !== "rescued" && status !== "dead") {
      let seed = (x * 374761393) ^ (y * 668265263);
      ctx.save();
      ctx.fillStyle = "rgba(80,72,62,0.9)";
      for (let i = 0; i < 10; i += 1) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const rx = px - cell * 0.4 + ((seed & 0xffff) / 0xffff) * cell * 0.8;
        const ry = py - cell * 0.35 + (((seed >>> 16) & 0xffff) / 0xffff) * cell * 0.7;
        const sz = 1.5 + ((seed >>> 4) & 3);
        ctx.fillRect(rx, ry, sz, sz);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowBlur = status === "trapped" ? 8 : 3;
    ctx.shadowColor = color;
    if (tier === "standing") {
      const armW = Math.max(2, cell * 0.1);
      const armL = Math.max(8, cell * 0.42);
      ctx.fillRect(px - armW / 2, py - armL / 2, armW, armL);
      ctx.fillRect(px - armL / 2, py - armW / 2, armL, armW);
    } else if (tier === "sitting") {
      const r = Math.max(3, cell * 0.18);
      ctx.beginPath();
      ctx.arc(px, py - cell * 0.08, r, 0, Math.PI * 2);
      ctx.fill();
      const armW = Math.max(1.5, cell * 0.08);
      const armL = Math.max(5, cell * 0.28);
      ctx.fillRect(px - armW / 2, py - cell * 0.05, armW, armL);
    } else {
      const r = Math.max(2, cell * 0.13);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = color;
    ctx.font = "9px 'Courier New', monospace";
    ctx.fillText(victim.id, px - 8, py - cell * 0.42);

    if (status === "trapped" || status === "unknown") {
      const maxHp = 10000;
      const pct = Math.max(0, Math.min(1, victim.hp / maxHp));
      const barW = cell * 0.7;
      const barH = 3;
      const barX = px - barW / 2;
      const barY = py + cell * 0.3;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(barX, barY, barW, barH);
      const r = Math.round(255 * (1 - pct));
      const g = Math.round(180 * pct);
      ctx.fillStyle = `rgb(${r},${g},0)`;
      ctx.fillRect(barX, barY, barW * pct, barH);
    }
  }
}

function drawBase(cell) {
  const [x, y] = state.map.base;
  ctx.save();
  ctx.strokeStyle = "#ffe44d";
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ffe44d";
  ctx.strokeRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffe44d";
  ctx.font = "bold 9px 'Courier New', monospace";
  ctx.fillText("BASE", x * cell + 1, y * cell + cell / 2 + 3);
  ctx.restore();
}

function drawAgents(cell, t) {
  const frac = Math.min(1, Math.max(0, (performance.now() - lastTickAt) / MS_PER_TICK));
  for (const agent of state.agents) {
    const prev = agent.prevLocation || agent.location;
    const ix = lerp(prev[0], agent.location[0], frac);
    const iy = lerp(prev[1], agent.location[1], frac);
    const px = (ix + 0.5) * cell;
    const py = (iy + 0.5) * cell;
    const battery = (agent.battery || 0) / 100;
    const trail = trails.get(agent.id);

    if (agent.type === "drone") {
      drawUAV(agent, px, py, cell, battery, agent.perception_range || 4, t, trail);
    } else {
      drawUGV(agent, px, py, cell, battery, t, trail);
    }
    drawAgentLabel(agent.id, px, py, agentAccentColor(agent));
  }
}

function drawTrail(trail, cell, color) {
  if (!trail || trail.length < 2) return;
  for (let i = 1; i < trail.length; i += 1) {
    const a = trail[i - 1];
    const b = trail[i];
    const alpha = (i / trail.length) * 0.5;
    ctx.strokeStyle = color.replace(")", `,${alpha})`).replace("rgb", "rgba");
    ctx.lineWidth = lerp(0.5, 2, i / trail.length);
    ctx.beginPath();
    ctx.moveTo((a.x + 0.5) * cell, (a.y + 0.5) * cell);
    ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
    ctx.stroke();
  }
}

const AGENT_PALETTE = {
  scout:          { rgb: "0,191,255",  hex: "#00bfff" },
  relay:          { rgb: "180,140,255", hex: "#b48cff" },
  rescue:         { rgb: "57,255,20",  hex: "#39ff14" },
  clear_blockade: { rgb: "255,160,40", hex: "#ffa028" }
};

function agentAccent(agent) {
  return AGENT_PALETTE[agent.role] || (agent.type === "drone" ? AGENT_PALETTE.scout : AGENT_PALETTE.rescue);
}

function agentAccentColor(agent) {
  return agentAccent(agent).hex;
}

function drawUAV(agent, px, py, cell, battery, scanRange, t, trail) {
  const accent = agentAccent(agent);
  const color = `rgb(${accent.rgb})`;
  drawTrail(trail, cell, color);

  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, scanRange * cell, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${accent.rgb},0.25)`;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -t * 10;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `rgba(${accent.rgb},0.04)`;
  ctx.fill();
  ctx.restore();

  const arms = agent.role === "relay" ? 6 : 4;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(t * 8);
  ctx.strokeStyle = accent.hex;
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 10;
  ctx.shadowColor = accent.hex;
  const arm = Math.min(8, cell * 0.4);
  const rotor = Math.max(2, cell * 0.13);
  const sweep = (Math.PI * 2) / arms;
  for (let i = 0; i < arms; i += 1) {
    ctx.rotate(sweep);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(arm, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(arm + rotor * 0.3, 0, rotor, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = accent.hex;
  ctx.fill();
  ctx.restore();

  if (agent.role === "relay") {
    ctx.save();
    ctx.strokeStyle = accent.hex;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 6;
    ctx.shadowColor = accent.hex;
    const mast = cell * 0.55;
    ctx.beginPath();
    ctx.moveTo(px, py - 2);
    ctx.lineTo(px, py - mast);
    ctx.stroke();
    ctx.beginPath();
    const tipR = Math.max(2.5, cell * 0.11);
    ctx.arc(px, py - mast, tipR, 0, Math.PI * 2);
    ctx.stroke();
    const pulse = 0.4 + 0.6 * (Math.sin(t * 4) * 0.5 + 0.5);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = accent.hex;
    ctx.fill();
    ctx.restore();
  } else if (agent.role === "scout") {
    ctx.save();
    ctx.strokeStyle = accent.hex;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 4;
    ctx.shadowColor = accent.hex;
    const lensR = Math.max(2, cell * 0.1);
    ctx.beginPath();
    ctx.arc(px, py + cell * 0.18, lensR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py + cell * 0.18, lensR * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${accent.rgb},0.7)`;
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = battery < 0.15 ? "#ff4444" : battery < 0.3 ? "#ff8c00" : accent.hex;
  ctx.font = "9px 'Courier New', monospace";
  ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawUGV(agent, px, py, cell, battery, t, trail) {
  const accent = agentAccent(agent);
  const color = `rgb(${accent.rgb})`;

  if (trail && trail.length > 1) {
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -t * 8;
    for (let i = 1; i < trail.length; i += 1) {
      const a = trail[i - 1];
      const b = trail[i];
      const alpha = (i / trail.length) * 0.45;
      ctx.strokeStyle = `rgba(${accent.rgb},${alpha})`;
      ctx.lineWidth = lerp(0.5, 1.5, i / trail.length);
      ctx.beginPath();
      ctx.moveTo((a.x + 0.5) * cell, (a.y + 0.5) * cell);
      ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  const body = cell * 0.5;
  const half = body / 2;
  ctx.strokeStyle = accent.hex;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(px - half, py - half, body, body);
  ctx.fillStyle = `rgba(${accent.rgb},0.18)`;
  ctx.fillRect(px - half, py - half, body, body);
  ctx.fillStyle = accent.hex;

  if (agent.role === "clear_blockade") {
    const trackW = Math.max(2.5, body * 0.22);
    ctx.fillRect(px - half - trackW - 1, py - half, trackW, body);
    ctx.fillRect(px + half + 1, py - half, trackW, body);
    ctx.fillStyle = `rgba(${accent.rgb},0.55)`;
    const treadStep = Math.max(2, body * 0.18);
    for (let yy = py - half + 1; yy < py + half; yy += treadStep) {
      ctx.fillRect(px - half - trackW - 1, yy, trackW, 1);
      ctx.fillRect(px + half + 1, yy, trackW, 1);
    }
    ctx.save();
    ctx.strokeStyle = accent.hex;
    ctx.lineWidth = 1.4;
    const claw = cell * 0.32;
    const reach = Math.sin(t * 2.2) * 0.25 + 0.55;
    const ax = px;
    const ay = py - half - 1;
    const bx = ax;
    const by = ay - claw * reach;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx - 2.5, by);
    ctx.lineTo(bx, by - 3);
    ctx.lineTo(bx + 2.5, by);
    ctx.stroke();
    ctx.restore();
  } else {
    const wheelR = Math.max(1.5, body * 0.18);
    ctx.beginPath();
    ctx.arc(px - half - 1, py - half + wheelR, wheelR, 0, Math.PI * 2);
    ctx.arc(px - half - 1, py + half - wheelR, wheelR, 0, Math.PI * 2);
    ctx.arc(px + half + 1, py - half + wheelR, wheelR, 0, Math.PI * 2);
    ctx.arc(px + half + 1, py + half - wheelR, wheelR, 0, Math.PI * 2);
    ctx.fill();
    const crossArm = body * 0.55;
    const crossW = Math.max(1.5, body * 0.14);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px - crossArm / 2, py - crossW / 2, crossArm, crossW);
    ctx.fillRect(px - crossW / 2, py - crossArm / 2, crossW, crossArm);
  }
  ctx.restore();

  ctx.fillStyle = battery < 0.15 ? "#ff4444" : battery < 0.3 ? "#ff8c00" : accent.hex;
  ctx.font = "9px 'Courier New', monospace";
  ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawAgentLabel(id, px, py, color) {
  ctx.fillStyle = color;
  ctx.font = "9px 'Courier New', monospace";
  ctx.shadowBlur = 4;
  ctx.shadowColor = color;
  ctx.fillText(id, px - 14, py + 18);
  ctx.shadowBlur = 0;
}

function drawLabel(text, x, y, cell) {
  ctx.fillStyle = "#edf4f2";
  ctx.font = "700 10px sans-serif";
  ctx.fillText(text, x * cell + 3, y * cell + 11);
}

function circle(location, radius, cell, fill) {
  ctx.beginPath();
  ctx.arc(location[0] * cell, location[1] * cell, radius, 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}

function emitToast(type, description) {
  const style = TOAST_STYLES[type] || TOAST_STYLES.default;
  const layer = document.getElementById("toastLayer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.style.background = style.bg;
  el.style.borderLeftColor = style.color;
  el.style.color = style.color;
  el.textContent = description;
  layer.appendChild(el);
  el.animate(
    [
      { opacity: 0, transform: "translateX(20px)" },
      { opacity: 1, transform: "translateX(0)" }
    ],
    { duration: 280, fill: "forwards" }
  );
  setTimeout(() => {
    const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, fill: "forwards" });
    fade.onfinish = () => el.remove();
  }, 2600);
  pushEventLog(type, description, style.color);
}

function pushEventLog(type, description, color) {
  const log = document.getElementById("eventLog");
  if (!log) return;
  const row = document.createElement("div");
  row.className = "event-row";
  row.style.borderLeftColor = color;
  row.style.color = color;
  row.textContent = `t${state ? state.timestep : 0} · ${description}`;
  log.prepend(row);
  while (log.children.length > MAX_EVENT_LOG) log.lastChild.remove();
}

function popCounter(el, val) {
  el.textContent = val;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  setTimeout(() => el.classList.remove("pop"), 260);
}

function typewriter(el, text, speed = 18) {
  clearInterval(typewriterTimer);
  el.textContent = "";
  let i = 0;
  typewriterTimer = setInterval(() => {
    el.textContent += text.charAt(i);
    i += 1;
    if (i >= text.length) clearInterval(typewriterTimer);
  }, speed);
}

function renderPanels() {
  tickLabel.textContent = `Timestep ${state.timestep}`;
  if (rescuedCount.textContent !== String(state.rescued)) {
    rescuedCount.textContent = state.rescued;
  }

  const candidates = rankVictims();
  priorityList.innerHTML = candidates.map((candidate) => `
    <div class="row">
      <strong>${candidate.id}</strong>
      <div>
        <div class="bar" style="--value: ${candidate.score * 100}%"><i></i></div>
        <span>HP ${candidate.hp} / survival ${candidate.survival_steps} / ${candidate.communication_status}</span>
      </div>
      <b class="tag">${candidate.score.toFixed(2)}</b>
    </div>
  `).join("");

  agentList.innerHTML = state.agents.map((agent) => `
    <div class="row">
      <strong>${agent.id}</strong>
      <div>
        <div class="bar" style="--value: ${agent.battery}%"><i></i></div>
        <span>${agent.role} / ${agent.location.map((item) => Math.round(item)).join(", ")}</span>
      </div>
      <b class="tag">${Math.round(agent.battery)}%</b>
    </div>
  `).join("");

  typewriter(briefText, plan.commander_briefing);
  missionJson.textContent = JSON.stringify(plan, null, 2);
  drawSurvivalChart();
  updateAgentCards();
}

function drawSurvivalChart() {
  if (!chartCtx || !survivalChart) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = survivalChart.clientWidth || 380;
  const cssH = survivalChart.clientHeight || 160;
  if (survivalChart.width !== Math.round(cssW * dpr)) {
    survivalChart.width = Math.round(cssW * dpr);
    survivalChart.height = Math.round(cssH * dpr);
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const W = cssW;
  const H = cssH;
  chartCtx.clearRect(0, 0, W, H);

  chartCtx.strokeStyle = "rgba(0,191,255,0.12)";
  chartCtx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i += 1) {
    const y = (H - 20) * (i / 4) + 4;
    chartCtx.beginPath();
    chartCtx.moveTo(28, y);
    chartCtx.lineTo(W - 8, y);
    chartCtx.stroke();
  }
  chartCtx.fillStyle = "rgba(0,191,255,0.55)";
  chartCtx.font = "9px 'Courier New', monospace";
  chartCtx.fillText("100%", 2, 9);
  chartCtx.fillText("50%", 4, (H - 20) / 2 + 7);
  chartCtx.fillText("0%", 8, H - 20 + 4);

  if (survivalHistory.length < 1) return;
  const n = survivalHistory.length;
  const xAt = (i) => 28 + (W - 36) * (n === 1 ? 0 : i / (n - 1));
  const yAt = (pct) => (H - 20) * (1 - pct) + 4;

  chartCtx.beginPath();
  chartCtx.moveTo(xAt(0), H - 16);
  for (let i = 0; i < n; i += 1) chartCtx.lineTo(xAt(i), yAt(survivalHistory[i].alive));
  chartCtx.lineTo(xAt(n - 1), H - 16);
  chartCtx.closePath();
  chartCtx.fillStyle = "rgba(57,255,20,0.18)";
  chartCtx.fill();

  chartCtx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const x = xAt(i);
    const y = yAt(survivalHistory[i].alive);
    if (i === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  }
  chartCtx.strokeStyle = "#39ff14";
  chartCtx.lineWidth = 1.5;
  chartCtx.shadowBlur = 6;
  chartCtx.shadowColor = "#39ff14";
  chartCtx.stroke();
  chartCtx.shadowBlur = 0;

  chartCtx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const x = xAt(i);
    const y = yAt(survivalHistory[i].rescued);
    if (i === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  }
  chartCtx.strokeStyle = "#00bfff";
  chartCtx.lineWidth = 1.2;
  chartCtx.setLineDash([4, 3]);
  chartCtx.stroke();
  chartCtx.setLineDash([]);

  chartCtx.fillStyle = "#39ff14";
  chartCtx.fillText("alive", W - 78, H - 4);
  chartCtx.fillStyle = "#00bfff";
  chartCtx.fillText("rescued", W - 42, H - 4);
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function stopAuto() {
  clearInterval(timer);
  timer = null;
  autoBtn.textContent = "Run";
}

function onAutoToggle() {
  if (timer) {
    stopAuto();
    return;
  }
  autoBtn.textContent = "Pause";
  timer = setInterval(step, 900);
}

stepBtn.addEventListener("click", step);
resetBtn.addEventListener("click", reset);
autoBtn.addEventListener("click", onAutoToggle);

/* ──────────────────────────────────────────────────────────────────────────
   3D first-person view
   ────────────────────────────────────────────────────────────────────────── */

function computeRoadCells(scenario) {
  const cells = new Set<string>();
  if (!scenario.map.roads) return cells;
  for (const road of scenario.map.roads) {
    const pts = road.points;
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

function addTerrainPatches3D(scenario) {
  if (!scenario.map.terrain) return;
  const palettes = {
    grass:  { color: 0x2d4a25, roughness: 0.95, metalness: 0.02, emissive: 0x000000 },
    water:  { color: 0x1c3550, roughness: 0.2,  metalness: 0.5,  emissive: 0x031530 },
    rubble: { color: 0x3d3a35, roughness: 0.98, metalness: 0.02, emissive: 0x000000 },
    plaza:  { color: 0x3a4250, roughness: 0.92, metalness: 0.05, emissive: 0x000000 }
  };

  for (const patch of scenario.map.terrain) {
    const [px, py, pw, ph] = patch.footprint;
    const palette = palettes[patch.kind] || palettes.plaza;
    const mat = new THREE.MeshStandardMaterial({
      color: palette.color,
      roughness: palette.roughness,
      metalness: palette.metalness,
      emissive: palette.emissive,
      emissiveIntensity: patch.kind === "water" ? 0.3 : 0.0
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(px + pw / 2, 0.012, py + ph / 2);
    world.scene.add(mesh);

    if (patch.kind === "rubble") {
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5a4838, roughness: 0.95 });
      const stoneCount = Math.floor(pw * ph * 3);
      for (let i = 0; i < stoneCount; i += 1) {
        const sx = px + 0.1 + hash01(px + i, py, 101) * (pw - 0.2);
        const sz = py + 0.1 + hash01(px, py + i, 102) * (ph - 0.2);
        const sw = 0.1 + hash01(sx, sz, 103) * 0.18;
        const sh = 0.06 + hash01(sx, sz, 104) * 0.12;
        const sd = 0.1 + hash01(sx, sz, 105) * 0.18;
        const stone = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), stoneMat);
        stone.position.set(sx, sh / 2 + 0.02, sz);
        stone.rotation.y = hash01(sx, sz, 106) * Math.PI * 2;
        stone.rotation.x = (hash01(sx, sz, 107) - 0.5) * 0.5;
        world.scene.add(stone);
      }
    } else if (patch.kind === "grass") {
      const tuftMat = new THREE.MeshStandardMaterial({ color: 0x3a5a30, roughness: 0.9 });
      const tuftCount = Math.floor(pw * ph * 2);
      for (let i = 0; i < tuftCount; i += 1) {
        const tx = px + 0.1 + hash01(px + i, py, 111) * (pw - 0.2);
        const tz = py + 0.1 + hash01(px, py + i, 112) * (ph - 0.2);
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 5), tuftMat);
        tuft.position.set(tx, 0.09, tz);
        world.scene.add(tuft);
      }
    }
  }
}

function makeGradientSkyTexture(size = 512) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = size;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0.0,  "#08101a");
  grad.addColorStop(0.45, "#1a1612");
  grad.addColorStop(0.72, "#3a2418");
  grad.addColorStop(0.88, "#5a3a22");
  grad.addColorStop(1.0,  "#1c1610");
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildHorizonSilhouette(scenario) {
  const [cols, rows] = scenario.map.size;
  const cx = cols / 2;
  const cz = rows / 2;
  const baseRadius = Math.max(cols, rows) * 1.35;
  const silMat = new THREE.MeshBasicMaterial({ color: 0x0a0d13, fog: false });
  const COUNT = 96;
  const baseGeom = new THREE.BoxGeometry(1, 1, 1);
  const instMesh = new THREE.InstancedMesh(baseGeom, silMat, COUNT);
  const dummy = new THREE.Object3D();
  const lit = new THREE.Color(0x261c14);
  for (let i = 0; i < COUNT; i += 1) {
    const angle = (i / COUNT) * Math.PI * 2;
    const r = baseRadius + hash01(i, 0, 91) * 10;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    const w = 1.6 + hash01(i, 0, 92) * 3.0;
    const d = 1.6 + hash01(i, 0, 93) * 3.0;
    const h = 1.8 + hash01(i, 0, 94) * 6.5;
    dummy.position.set(x, h / 2, z);
    dummy.rotation.set(0, angle + Math.PI / 2 + (hash01(i, 0, 95) - 0.5) * 0.5, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    instMesh.setMatrixAt(i, dummy.matrix);
    if (hash01(i, 0, 96) > 0.85) instMesh.setColorAt(i, lit);
    else instMesh.setColorAt(i, new THREE.Color(0x0a0d13));
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
  const group = new THREE.Group();
  group.name = "horizon-silhouette";
  group.add(instMesh);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4 + 0.1) * Math.PI * 2;
    const r = baseRadius + 4;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    const phase = i * 1.5;
    for (let p = 0; p < 6; p += 1) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(2.2 + p * 0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x1e1a17, transparent: true, opacity: 0.5 - p * 0.06, depthWrite: false, fog: false })
      );
      sphere.position.set(x + Math.sin(phase + p) * 1.2, 6 + p * 2.5, z + Math.cos(phase + p) * 1.2);
      group.add(sphere);
    }
  }
  world.scene.add(group);
  world.horizonSilhouette = group;
}

function addStreetFurniture(scenario) {
  const [cols, rows] = scenario.map.size;
  const roadCells = computeRoadCells(scenario);
  const riskZones = scenario.map.risk_zones || [];

  const hLines = new Set<number>();
  const vLines = new Set<number>();
  for (const road of scenario.map.roads || []) {
    const pts = road.points;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a[1] === b[1]) hLines.add(a[1]);
      if (a[0] === b[0]) vLines.add(a[0]);
    }
  }

  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.85, metalness: 0.3 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x32363c, roughness: 0.8, metalness: 0.4 });

  for (const y of hLines) {
    for (const x of vLines) {
      if (x === 0 || x === cols - 1 || y === 0 || y === rows - 1) continue;
      const damage = cellDamageLevel(x, y, riskZones);
      for (const ox of [-1, 1]) {
        for (const oz of [-1, 1]) {
          const px = x + 0.5 + ox * 0.55;
          const pz = y + 0.5 + oz * 0.55;
          const lamp = new THREE.Group();
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.4, 8), postMat);
          post.position.y = 0.7;
          lamp.add(post);
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 6), armMat);
          arm.rotation.z = Math.PI / 2;
          arm.position.set(-ox * 0.12, 1.35, 0);
          lamp.add(arm);
          const isLit = damage < 0.4 && hash01(x, y, 50 + ox + oz * 2) > 0.15;
          const lampMat = new THREE.MeshStandardMaterial({
            color: isLit ? 0xffe9b0 : 0x1a1614,
            emissive: isLit ? 0xffd080 : 0x000000,
            emissiveIntensity: isLit ? 0.9 : 0,
            roughness: 0.7
          });
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.18), lampMat);
          head.position.set(-ox * 0.24, 1.32, 0);
          lamp.add(head);
          if (isLit) {
            const light = new THREE.PointLight(0xffd080, 0.6, 4.5);
            light.position.set(-ox * 0.24, 1.32, 0);
            lamp.add(light);
          }
          lamp.position.set(px, 0, pz);
          if (damage > 0.45) {
            lamp.rotation.z = (hash01(x, y, 51 + ox + oz * 2) - 0.5) * 0.6;
            lamp.rotation.x = (hash01(x, y, 52 + ox + oz * 2) - 0.5) * 0.3;
          }
          world.scene.add(lamp);
        }
      }
    }
  }

  if (scenario.map.terrain) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d4a25, roughness: 0.9 });
    const fallenLeafMat = new THREE.MeshStandardMaterial({ color: 0x4a3522, roughness: 0.95 });
    for (const patch of scenario.map.terrain) {
      if (patch.kind !== "grass") continue;
      const [px, py, pw, ph] = patch.footprint;
      const treeCount = Math.max(1, Math.floor(pw * ph * 0.5));
      for (let i = 0; i < treeCount; i += 1) {
        const tx = px + 0.3 + hash01(px + i, py, 41) * (pw - 0.6);
        const tz = py + 0.3 + hash01(px, py + i, 42) * (ph - 0.6);
        const damage = cellDamageLevel(Math.floor(tx), Math.floor(tz), riskZones);
        const fallen = damage > 0.4 && hash01(tx, tz, 44) > 0.4;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), trunkMat);
        trunk.position.y = 0.25;
        tree.add(trunk);
        const leaves = new THREE.Mesh(
          new THREE.ConeGeometry(0.35, 0.7, 8),
          fallen ? fallenLeafMat : leafMat
        );
        leaves.position.y = 0.7;
        tree.add(leaves);
        tree.position.set(tx, 0, tz);
        tree.scale.setScalar(0.8 + hash01(tx, tz, 43) * 0.6);
        if (fallen) {
          tree.rotation.z = Math.PI / 2 * (hash01(tx, tz, 45) > 0.5 ? 1 : -1) * 0.85;
        }
        world.scene.add(tree);
      }
    }
  }

  const hydrantMat = new THREE.MeshStandardMaterial({ color: 0x9a2820, roughness: 0.6, metalness: 0.2 });
  for (let i = 0; i < 14; i += 1) {
    const cx = Math.floor(hash01(i, 7, 61) * cols);
    const cz = Math.floor(hash01(i, 11, 62) * rows);
    if (!roadCells.has(`${cx},${cz}`)) continue;
    const hydrant = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.28, 8), hydrantMat);
    body.position.y = 0.14;
    hydrant.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.07, 8), hydrantMat);
    top.position.y = 0.32;
    hydrant.add(top);
    hydrant.position.set(cx + 0.5 + 0.42, 0, cz + 0.5 + 0.42);
    world.scene.add(hydrant);
  }
}

function addFireSmoke(scenario) {
  const fireZones = (scenario.map.risk_zones || []).filter((z) => z.type === "fire");
  if (!fireZones.length) return;
  world.smokePuffs = world.smokePuffs || [];
  world.fireGlows = world.fireGlows || [];

  for (const z of fireZones) {
    const baseX = z.center[0] + 0.5;
    const baseZ = z.center[1] + 0.5;

    const glow = new THREE.PointLight(0xff6020, 2.0, 9, 1.8);
    glow.position.set(baseX, 0.6, baseZ);
    world.scene.add(glow);
    world.fireGlows.push(glow);

    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff8c30, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), emberMat);
    ember.position.set(baseX, 0.25, baseZ);
    world.scene.add(ember);
    world.fireGlows.push({ ember, _isEmber: true, x: baseX, z: baseZ });

    const PUFF_COUNT = 12;
    const PLUME_HEIGHT = 14;
    for (let i = 0; i < PUFF_COUNT; i += 1) {
      const phase = i / PUFF_COUNT;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0x1f1c19,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          fog: true
        })
      );
      sphere.position.set(baseX, 0.6 + phase * PLUME_HEIGHT, baseZ);
      world.scene.add(sphere);
      world.smokePuffs.push({ mesh: sphere, baseX, baseZ, baseY: 0.6, height: PLUME_HEIGHT, phase, zoneId: z.id });
    }
  }
}

function updateSmokeAndGlows(t) {
  if (world.smokePuffs) {
    const ageNorm = (t * 0.045) % 1;
    for (const p of world.smokePuffs) {
      const localT = (p.phase + ageNorm) % 1;
      p.mesh.position.y = p.baseY + localT * p.height;
      const sizeFactor = 0.65 + localT * 1.8;
      p.mesh.scale.setScalar(sizeFactor);
      p.mesh.position.x = p.baseX + Math.sin(t * 0.6 + p.phase * 6) * localT * 0.7;
      p.mesh.position.z = p.baseZ + Math.cos(t * 0.55 + p.phase * 5) * localT * 0.7;
      const mat = p.mesh.material;
      if (mat) {
        const dark = 0.12 - localT * 0.04;
        mat.color.setRGB(Math.max(0.04, dark + 0.04), Math.max(0.03, dark + 0.02), Math.max(0.03, dark));
        mat.opacity = Math.max(0, 0.75 - localT * 0.7);
      }
    }
  }
  if (world.fireGlows) {
    for (const g of world.fireGlows) {
      if (g._isEmber) {
        const flicker = 0.7 + Math.sin(t * 9 + g.x) * 0.3 + Math.sin(t * 14 + g.z) * 0.2;
        g.ember.scale.setScalar(Math.max(0.4, flicker));
        const mat = g.ember.material;
        if (mat) mat.opacity = 0.6 + Math.sin(t * 11) * 0.25;
      } else if (g.intensity !== undefined) {
        g.intensity = 1.6 + Math.sin(t * 8 + g.position.x) * 0.5 + Math.sin(t * 13 + g.position.z) * 0.3;
      }
    }
  }
}

function buildRoads3D(scenario) {
  if (!scenario.map.roads) return;

  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.95, metalness: 0.05 });
  const curbMat    = new THREE.MeshStandardMaterial({ color: 0x586173, roughness: 0.85, metalness: 0.05 });
  const yellowMat  = new THREE.MeshStandardMaterial({ color: 0xffe44d, emissive: 0xffe44d, emissiveIntensity: 0.45, roughness: 0.6 });
  const whiteMat   = new THREE.MeshStandardMaterial({ color: 0xd6dde4, emissive: 0xd6dde4, emissiveIntensity: 0.18, roughness: 0.7 });

  const group = new THREE.Group();
  group.name = "roads3d";

  for (const road of scenario.map.roads) {
    const isMain = road.kind === "main";
    const width = isMain ? 1.0 : 0.7;
    const pts = road.points;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const ax = a[0] + 0.5;
      const az = a[1] + 0.5;
      const bx = b[0] + 0.5;
      const bz = b[1] + 0.5;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const yaw = Math.atan2(dz, dx);

      const asphalt = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.03, width), asphaltMat);
      asphalt.position.set(cx, 0.018, cz);
      asphalt.rotation.y = -yaw;
      group.add(asphalt);

      const perpX = -dz / len;
      const perpZ = dx / len;
      const curbW = 0.08;
      const curbH = 0.07;
      const curbOffset = width / 2 + curbW / 2;
      for (const side of [-1, 1]) {
        const curb = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, curbH, curbW), curbMat);
        curb.position.set(cx + perpX * curbOffset * side, curbH / 2 + 0.005, cz + perpZ * curbOffset * side);
        curb.rotation.y = -yaw;
        group.add(curb);
      }

      if (isMain) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, 0.004, 0.06), yellowMat);
        stripe.position.set(cx, 0.038, cz);
        stripe.rotation.y = -yaw;
        group.add(stripe);
      } else {
        const dashLen = 0.45;
        const gapLen = 0.5;
        const step = dashLen + gapLen;
        const count = Math.max(1, Math.floor(len / step));
        const total = count * step - gapLen;
        let pos = -total / 2 + dashLen / 2;
        for (let k = 0; k < count; k += 1) {
          const dash = new THREE.Mesh(new THREE.BoxGeometry(dashLen, 0.004, 0.045), whiteMat);
          dash.position.set(cx + (dx / len) * pos, 0.038, cz + (dz / len) * pos);
          dash.rotation.y = -yaw;
          group.add(dash);
          pos += step;
        }
      }
    }
  }

  world.scene.add(group);
  world.roadsGroup = group;
}

function init3D(scenario) {
  if (world.initialized || povCols.length === 0) return;
  const [cols, rows] = scenario.map.size;

  // Build shared scene once
  world.scene = new THREE.Scene();
  world.scene.background = new THREE.Color(0x070d16);
  world.scene.fog = new THREE.FogExp2(0x080f1a, 0.028);

  // Three-point rig: warm hemi from above, cool fill, soft rim
  const hemi = new THREE.HemisphereLight(0x5680c0, 0x0a0f1a, 0.7);
  world.scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0d8, 0.75);
  key.position.set(20, 30, 10);
  world.scene.add(key);
  const fill = new THREE.DirectionalLight(0x4a78b0, 0.35);
  fill.position.set(-15, 12, -8);
  world.scene.add(fill);
  const rim = new THREE.PointLight(0x00bfff, 0.7, 80);
  rim.position.set(cols / 2, 22, rows / 2);
  world.scene.add(rim);

  // Ground — neon grid placeholder, swapped to concrete after assets load
  const gridTex = makeGridTexture(512, cols, rows);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(cols, rows),
    new THREE.MeshStandardMaterial({
      map: gridTex,
      color: 0x0a1828,
      roughness: 0.9,
      metalness: 0.05,
      emissive: 0x001a33,
      emissiveIntensity: 0.4
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cols / 2, 0, rows / 2);
  world.scene.add(ground);
  world.groundGrid = ground;

  // Sky-dome — disaster gradient (smoky orange near horizon, dark zenith)
  const skyTex = makeGradientSkyTexture(512);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  world.scene.add(sky);

  // Distant city silhouette ring — implies the destroyed city extends beyond the map
  buildHorizonSilhouette(scenario);

  // Terrain patches — grass parks, water canal, rubble fields, plaza tile
  addTerrainPatches3D(scenario);

  // Base marker
  const [bx, by] = scenario.map.base;
  const base = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffe44d,
      emissive: 0xffe44d,
      emissiveIntensity: 0.9,
      roughness: 0.4
    })
  );
  pad.position.y = 0.04;
  base.add(pad);
  const beacon = new THREE.PointLight(0xffe44d, 0.9, 8);
  beacon.position.y = 1.5;
  base.add(beacon);
  base.position.set(bx + 0.5, 0, by + 0.5);
  world.scene.add(base);
  world.baseMesh = base;

  // Blockades
  for (const blk of scenario.map.blocked_cells) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.85, metalness: 0.1 })
    );
    mesh.position.set(blk.location[0] + 0.5, 0.6, blk.location[1] + 0.5);
    world.scene.add(mesh);
    world.blockadeMeshes.set(blk.id, mesh);
  }

  // Risk zones — subtle: thin ground ring + a small atmospheric column (no harsh disk)
  for (const zone of scenario.map.risk_zones) {
    const isFire = zone.type === "fire";
    const baseColor = isFire ? 0xff7a3c : 0xa887ff;

    const grp = new THREE.Group();
    grp.position.set(zone.center[0] + 0.5, 0, zone.center[1] + 0.5);

    // Thin ground ring (annulus) — like a survey marker
    const ringInner = Math.max(0.1, zone.radius - 0.18);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringInner, zone.radius, 64),
      new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.25, side: THREE.DoubleSide, fog: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    grp.add(ring);

    // Tiny core glow at center — vertical pillar-of-light implied
    const halo = new THREE.PointLight(baseColor, isFire ? 0.85 : 0.45, zone.radius * 3.5);
    halo.position.y = 1.4;
    grp.add(halo);

    // For fire: a thin vertical "smoke column" billboard
    let column = null;
    if (isFire) {
      const colGeo = new THREE.CylinderGeometry(0.05, 0.18, 3.2, 8, 1, true);
      const colMat = new THREE.MeshBasicMaterial({
        color: 0xff4a1a,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true
      });
      column = new THREE.Mesh(colGeo, colMat);
      column.position.y = 1.6;
      grp.add(column);
    }

    world.scene.add(grp);
    world.riskMeshes.set(zone.id, { group: grp, ring, halo, column, baseColor, isFire });
  }

  // Victims
  for (const v of scenario.victims) {
    const grp = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0xff6666, emissive: 0xff6666, emissiveIntensity: 0.6 })
    );
    post.position.y = 0.45;
    grp.add(post);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xff6666, emissive: 0xff6666, emissiveIntensity: 0.6 })
    );
    arm.position.y = 0.75;
    grp.add(arm);
    const flare = new THREE.PointLight(0xff6666, 0.7, 4);
    flare.position.y = 0.8;
    grp.add(flare);
    grp.position.set(v.location[0] + 0.5, 0, v.location[1] + 0.5);
    world.scene.add(grp);
    world.victimMeshes.set(v.id, { group: grp, post, arm, flare });
  }

  // Real 3D road network — asphalt strips + curbs + lane markings
  buildRoads3D(scenario);

  // Fire smoke plumes + flickering glow — visible from anywhere in the city
  addFireSmoke(scenario);

  // Street furniture: lampposts at intersections, trees in parks, hydrants
  addStreetFurniture(scenario);

  // Agents — detailed primitive build matching the marketing hero aesthetic
  for (const a of scenario.agents) {
    const grp = a.type === "drone" ? createDroneMesh() : createUgvMesh();
    grp.position.set(a.location[0] + 0.5, a.type === "drone" ? 1.5 : 0, a.location[1] + 0.5);
    world.scene.add(grp);
    world.agentMeshes.set(a.id, grp);
  }

  // Create per-viewport renderer + camera
  povCols.forEach((col, i) => {
    const canvas = col.querySelector("[data-pov-canvas]");
    if (!canvas) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (err) {
      console.warn(`WebGL unavailable for POV ${i}`, err);
      canvas.replaceWith(Object.assign(document.createElement("div"), {
        style: "padding: 16px; color: #ff8c00; font-size: 10px; text-align: center;",
        textContent: "WebGL unavailable"
      }));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x02060f, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const camera = new THREE.PerspectiveCamera(72, 16 / 10, 0.1, 200);
    camera.position.set(cols / 2, 1.5, rows / 2);
    camera.lookAt(cols / 2 + 1, 0.8, rows / 2);

    const initialId = DEFAULT_POV_AGENTS[i] || scenario.agents[i]?.id || scenario.agents[0]?.id;
    const heading = col.querySelector("[data-pov-heading]");
    if (heading) heading.textContent = `FPV · ${initialId}`;

    const entry = {
      col,
      canvas,
      renderer,
      camera,
      selectedId: initialId,
      smoothPos: new THREE.Vector3().copy(camera.position),
      smoothLook: new THREE.Vector3(cols / 2 + 1, 0.8, rows / 2),
      smoothHdg: 0,
      smoothVel: 0,
      hud: {
        alt: col.querySelector("[data-hud='alt']"),
        hdg: col.querySelector("[data-hud='hdg']"),
        vel: col.querySelector("[data-hud='vel']"),
        pwr: col.querySelector("[data-hud='pwr']"),
        target: col.querySelector("[data-hud='target']"),
        heading
      }
    };

    const ro = new ResizeObserver(() => resizePov(entry));
    ro.observe(canvas.parentElement);
    entry.ro = ro;

    povs.push(entry);
    resizePov(entry);
  });

  // Rich agent-card switcher
  buildAgentSelector(scenario.agents);

  world.initialized = true;

  // Progressive asset upgrade — primitives show first, real geometry swaps in
  upgradeToAssets(scenario).catch((err) => console.warn("Asset upgrade failed:", err));
}

function createDroneMesh() {
  // Ported from components/hero/Drone.tsx — chunky utility quadcopter
  // Scaled down to ~0.6 world-units across to fit the 1-cell sim grid
  const SCALE = 0.42;
  const grp = new THREE.Group();
  grp.scale.setScalar(SCALE);

  const chassisColor = 0x1c1f25;
  const trimColor = 0x33383f;

  const chassisMat = new THREE.MeshStandardMaterial({ color: chassisColor, metalness: 0.55, roughness: 0.45 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.6, roughness: 0.4 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x06080a, metalness: 0.85, roughness: 0.18 });

  // Chassis (hex prism)
  const chassis = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.22, 6), chassisMat);
  chassis.rotation.y = Math.PI / 6;
  grp.add(chassis);

  // Top deck
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.06, 6), trimMat);
  deck.position.y = 0.13;
  deck.rotation.y = Math.PI / 6;
  grp.add(deck);

  // Antennas
  const antMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.6 });
  const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), antMat);
  a1.position.set(0.18, 0.28, -0.05);
  grp.add(a1);
  const a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6), antMat);
  a2.position.set(-0.16, 0.24, 0.06);
  grp.add(a2);

  // Nose sensor cowl
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.3, 12), trimMat);
  nose.position.set(0, -0.03, 0.4);
  nose.rotation.x = Math.PI / 2;
  grp.add(nose);

  // Camera ball
  const cam = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), blackMat);
  cam.position.set(0, -0.14, 0.5);
  grp.add(cam);
  // Lens highlight
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.9, roughness: 0.05, emissive: 0x1a3a32, emissiveIntensity: 0.4 })
  );
  lens.position.set(0, -0.14, 0.55);
  grp.add(lens);

  // Status ring (emissive band)
  const statusRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.012, 6, 28),
    new THREE.MeshStandardMaterial({ color: 0x5dffb4, emissive: 0x5dffb4, emissiveIntensity: 1.6, toneMapped: false })
  );
  statusRing.rotation.x = Math.PI / 2;
  statusRing.position.y = -0.02;
  grp.add(statusRing);

  // Arms (X-config)
  const armPositions = [
    [0.62, 0.04, 0.58],
    [-0.62, 0.04, 0.58],
    [0.62, 0.04, -0.58],
    [-0.62, 0.04, -0.58]
  ];
  const armMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.5, roughness: 0.55 });
  for (const [px, py, pz] of armPositions) {
    const angle = Math.atan2(pz, px);
    const armGrp = new THREE.Group();
    armGrp.position.set(px / 2, py, pz / 2);
    armGrp.rotation.y = -angle;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), armMat);
    arm.rotation.z = Math.PI / 2;
    armGrp.add(arm);
    grp.add(armGrp);
  }

  // Motor housings
  const motorMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.7, roughness: 0.3 });
  for (const [px, py, pz] of armPositions) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), motorMat);
    m.position.set(px, py + 0.05, pz);
    grp.add(m);
  }

  // Spinning rotor discs
  const rotors = new THREE.Group();
  const discMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.28, roughness: 0.9, depthWrite: false });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x181a1e, transparent: true, opacity: 0.55 });
  for (const [px, py, pz] of armPositions) {
    const rg = new THREE.Group();
    rg.position.set(px, py + 0.15, pz);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.012, 24), discMat);
    rg.add(disc);
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.012, 0.05), bladeMat);
    rg.add(b1);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.012, 0.05), bladeMat);
    b2.rotation.y = Math.PI / 2;
    rg.add(b2);
    rotors.add(rg);
  }
  grp.add(rotors);

  // Nav lights
  const navGreen = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x5dffb4, emissive: 0x5dffb4, emissiveIntensity: 3, toneMapped: false })
  );
  navGreen.position.set(0, 0, 0.58);
  grp.add(navGreen);
  const navRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xff5d6c, emissive: 0xff5d6c, emissiveIntensity: 2.2, toneMapped: false })
  );
  navRed.position.set(0, 0, -0.36);
  grp.add(navRed);
  const navBelly = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4, toneMapped: false })
  );
  navBelly.position.set(0, -0.13, 0);
  grp.add(navBelly);

  // Small cyan halo light so the drone reads from other POVs
  const navLight = new THREE.PointLight(0x00bfff, 1.4, 5);
  navLight.position.y = 0.05;
  grp.add(navLight);

  grp.userData = { rotors: rotors.children, statusRing, beacon: navGreen, navLight };
  return grp;
}

function createUgvMesh() {
  // Tracked rescue rover — sloped armor, light bar, segmented tracks
  const grp = new THREE.Group();
  const chassisColor = 0x222a22;
  const trimColor = 0x3a4a3a;

  const chassisMat = new THREE.MeshStandardMaterial({ color: chassisColor, metalness: 0.4, roughness: 0.6 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.5, roughness: 0.55 });

  // Main hull (boxy)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.7), chassisMat);
  hull.position.y = 0.22;
  grp.add(hull);

  // Sloped front armor
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.18), chassisMat);
  front.position.set(0, 0.25, 0.42);
  front.rotation.x = -0.35;
  grp.add(front);

  // Sensor turret on top
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.34), trimMat);
  turret.position.set(0, 0.36, -0.05);
  grp.add(turret);

  // Camera lens
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x06080a, metalness: 0.9, roughness: 0.08 })
  );
  lens.position.set(0, 0.36, 0.14);
  grp.add(lens);

  // Light bar (emissive)
  const lightBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.05, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x39ff14, emissive: 0x39ff14, emissiveIntensity: 1.8, toneMapped: false })
  );
  lightBar.position.set(0, 0.44, -0.05);
  grp.add(lightBar);

  // Tracks
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x141a14, roughness: 0.92, metalness: 0.05 });
  const treadOuter = new THREE.MeshStandardMaterial({ color: 0x1d251d, roughness: 0.85 });
  const trackL = new THREE.Group();
  trackL.position.x = -0.36;
  const trackR = new THREE.Group();
  trackR.position.x = 0.36;
  for (const side of [trackL, trackR]) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.78), trackMat);
    tread.position.y = 0.13;
    side.add(tread);
    // 6 segmented track plates on the visible side
    for (let i = 0; i < 6; i += 1) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.1), treadOuter);
      plate.position.set(side === trackL ? -0.025 : 0.025, 0.05, -0.32 + i * 0.13);
      side.add(plate);
    }
    grp.add(side);
  }

  // Headlights
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 1.6, toneMapped: false });
  const hlL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), hlMat);
  hlL.position.set(-0.2, 0.24, 0.52);
  grp.add(hlL);
  const hlR = hlL.clone();
  hlR.position.x = 0.2;
  grp.add(hlR);

  // Forward-throwing spot light (so other POVs see the UGV illuminate ground ahead)
  const spot = new THREE.SpotLight(0xfff2c8, 1.2, 6, Math.PI / 5, 0.55, 1.2);
  spot.position.set(0, 0.5, 0.4);
  spot.target.position.set(0, 0, 2.5);
  grp.add(spot);
  grp.add(spot.target);

  // Hover-light so the UGV reads from other POVs
  const navLight = new THREE.PointLight(0x39ff14, 1.0, 4);
  navLight.position.y = 0.5;
  grp.add(navLight);

  grp.userData = { navLight, lightBar, beacon: lightBar };
  return grp;
}

function resizePov(entry) {
  if (!entry || !entry.renderer || !entry.canvas.parentElement) return;
  const w = entry.canvas.parentElement.clientWidth;
  const h = entry.canvas.parentElement.clientHeight;
  if (w === 0 || h === 0) return;
  entry.renderer.setSize(w, h, false);
  entry.camera.aspect = w / h;
  entry.camera.updateProjectionMatrix();
}

function agentIcon(kind) {
  if (kind === "drone") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="2.6"/>
      <circle cx="18" cy="6" r="2.6"/>
      <circle cx="6" cy="18" r="2.6"/>
      <circle cx="18" cy="18" r="2.6"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
      <line x1="18" y1="6" x2="6" y2="18"/>
      <circle cx="12" cy="12" r="2.4" fill="currentColor"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="9" width="16" height="9" rx="1.5"/>
    <rect x="2.5" y="11" width="2" height="5" rx="0.8" fill="currentColor"/>
    <rect x="19.5" y="11" width="2" height="5" rx="0.8" fill="currentColor"/>
    <path d="M8 9 L8 6 L16 6 L16 9"/>
    <circle cx="12" cy="13.5" r="1.4" fill="currentColor"/>
  </svg>`;
}

function buildAgentSelector(agents) {
  if (!agentSelectorHost) return;
  agentSelectorHost.innerHTML = "";
  agentCardEls.clear();
  agents.forEach((a, idx) => {
    const kind = a.type === "drone" ? "drone" : "ground";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "agent-card";
    card.dataset.agentId = a.id;
    card.dataset.kind = kind;
    card.setAttribute("role", "tab");
    card.setAttribute("aria-controls", "povCanvas");
    card.setAttribute("aria-selected", "false");
    card.setAttribute("aria-label", `View ${a.id} first-person feed`);
    card.title = `${a.id} — ${a.role}. Press ${idx + 1} to select.`;
    card.tabIndex = idx === 0 ? 0 : -1;
    card.innerHTML = `
      <div class="agent-card-head">
        <span class="agent-icon">${agentIcon(a.type)}</span>
        <span class="agent-id">${a.id}</span>
      </div>
      <span class="agent-role">${a.role.replace("_", " ")}</span>
      <div class="agent-card-body">
        <span class="agent-task" data-task>idle</span>
        <div class="agent-battery">
          <div class="bar" style="--value: ${a.battery}%"><i></i></div>
          <span class="agent-battery-pct" data-battery-pct>${Math.round(a.battery)}%</span>
        </div>
      </div>
      <div class="agent-card-foot">
        <span></span>
        <kbd>${idx + 1}</kbd>
      </div>
    `;
    card.addEventListener("click", () => selectAgent(a.id));
    card.addEventListener("keydown", handleSelectorKey);
    agentSelectorHost.appendChild(card);
    agentCardEls.set(a.id, card);
  });

  document.addEventListener("keydown", handleGlobalSelectorKey);

  // Initial selection
  const firstId = DEFAULT_POV_AGENTS[0] || agents[0]?.id;
  if (firstId) selectAgent(firstId);
}

function selectAgent(id) {
  const entry = povs[0];
  if (!entry) return;
  entry.selectedId = id;
  if (entry.hud.heading) entry.hud.heading.textContent = `FPV · ${id}`;
  for (const [aid, el] of agentCardEls) {
    const active = aid === id;
    el.setAttribute("aria-selected", active ? "true" : "false");
    el.tabIndex = active ? 0 : -1;
    if (active) el.focus({ preventScroll: true });
  }
  // Update the sub-meta text in the header
  if (povSubEl && state) {
    const ag = state.agents.find((a) => a.id === id);
    if (ag) povSubEl.textContent = `${ag.role.replace("_", " ")} · battery ${Math.round(ag.battery)}%`;
  }
}

function cycleSelection(direction) {
  const entry = povs[0];
  if (!entry || agentCardEls.size === 0) return;
  const order = Array.from(agentCardEls.keys());
  const cur = order.indexOf(entry.selectedId);
  const next = order[(cur + direction + order.length) % order.length];
  selectAgent(next);
}

function handleSelectorKey(e) {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    cycleSelection(1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    cycleSelection(-1);
  } else if (e.key === "Home") {
    e.preventDefault();
    const first = Array.from(agentCardEls.keys())[0];
    if (first) selectAgent(first);
  } else if (e.key === "End") {
    e.preventDefault();
    const keys = Array.from(agentCardEls.keys());
    if (keys.length) selectAgent(keys[keys.length - 1]);
  }
}

function handleGlobalSelectorKey(e) {
  // Don't hijack when typing in a form field
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= agentCardEls.size) {
    const id = Array.from(agentCardEls.keys())[n - 1];
    if (id) {
      e.preventDefault();
      selectAgent(id);
    }
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    // Only if the active element isn't already the selector (avoid double-handling)
    const active = document.activeElement;
    if (!active || !active.classList || !active.classList.contains("agent-card")) {
      e.preventDefault();
      cycleSelection(e.key === "ArrowRight" ? 1 : -1);
    }
  }
}

function updateAgentCards() {
  if (!state) return;
  const planByAgent = new Map();
  if (plan?.mission_plan) {
    for (const a of plan.mission_plan) planByAgent.set(a.agent, a);
  }
  for (const a of state.agents) {
    const card = agentCardEls.get(a.id);
    if (!card) continue;
    const bar = card.querySelector(".bar");
    if (bar) bar.style.setProperty("--value", `${Math.max(0, Math.min(100, a.battery))}%`);
    const pct = card.querySelector("[data-battery-pct]");
    if (pct) pct.textContent = `${Math.round(a.battery)}%`;
    const task = card.querySelector("[data-task]");
    if (task) {
      const action = planByAgent.get(a.id);
      if (action) {
        task.textContent = `→ ${action.task.replace(/_/g, " ")} ${action.target || ""}`.trim();
        task.classList.add("has-task");
      } else {
        task.textContent = "idle";
        task.classList.remove("has-task");
      }
    }
  }
  // Header sub-meta tracks the active selection
  const entry = povs[0];
  if (povSubEl && entry) {
    const ag = state.agents.find((a) => a.id === entry.selectedId);
    if (ag) povSubEl.textContent = `${ag.role.replace("_", " ")} · battery ${Math.round(ag.battery)}%`;
  }
}

function fitToSize(obj, targetMaxDim) {
  const bbox = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  obj.scale.setScalar(targetMaxDim / maxDim);
}

function groundedY(obj) {
  const bbox = new THREE.Box3().setFromObject(obj);
  return -bbox.min.y;
}

async function upgradeToAssets(scenario) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(draco);
  const texLoader = new THREE.TextureLoader();

  const M = "public/models/";
  const T = "public/textures/";

  const [
    aptGlb, facadeGlb, mansionGlb, multiGlb,
    rubbleGlb, signsGlb, survivorGlb, taxiGlb,
    cBase, cNorm, cRough,
    bBase, bNorm, bRough,
    pBase, pNorm, pRough,
    dBase, dNorm, dRough
  ] = await Promise.all([
    loader.loadAsync(`${M}building-apartment.glb`),
    loader.loadAsync(`${M}building-facade.glb`),
    loader.loadAsync(`${M}building-mansion.glb`),
    loader.loadAsync(`${M}building-multistory.glb`),
    loader.loadAsync(`${M}rubble-large.glb`),
    loader.loadAsync(`${M}street-signs.glb`),
    loader.loadAsync(`${M}survivor.glb`),
    loader.loadAsync(`${M}vehicle-taxi.glb`),
    texLoader.loadAsync(`${T}concrete-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}concrete-a_normal.jpg`),
    texLoader.loadAsync(`${T}concrete-a_roughness.jpg`),
    texLoader.loadAsync(`${T}bricks-damage_basecolor.jpg`),
    texLoader.loadAsync(`${T}bricks-damage_normal.jpg`),
    texLoader.loadAsync(`${T}bricks-damage_roughness.jpg`),
    texLoader.loadAsync(`${T}plaster-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}plaster-a_normal.jpg`),
    texLoader.loadAsync(`${T}plaster-a_roughness.jpg`),
    texLoader.loadAsync(`${T}damage-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}damage-a_normal.jpg`),
    texLoader.loadAsync(`${T}damage-a_roughness.jpg`)
  ]);

  const prepTexSet = (base, norm, rough, repeat = 2) => {
    base.colorSpace = THREE.SRGBColorSpace;
    for (const tex of [base, norm, rough]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      tex.anisotropy = 4;
    }
  };
  prepTexSet(cBase, cNorm, cRough);
  prepTexSet(bBase, bNorm, bRough);
  prepTexSet(pBase, pNorm, pRough);
  prepTexSet(dBase, dNorm, dRough);

  const makeMat = (base, norm, rough, tint) => new THREE.MeshStandardMaterial({
    map: base,
    normalMap: norm,
    roughnessMap: rough,
    color: tint,
    roughness: 0.88,
    metalness: 0.06
  });
  const concreteMat = makeMat(cBase, cNorm, cRough, 0x95a1ad);
  const brickMat = makeMat(bBase, bNorm, bRough, 0xa17560);
  const plasterMat = makeMat(pBase, pNorm, pRough, 0xb2a48a);
  const damageMat = makeMat(dBase, dNorm, dRough, 0x6f6256);

  const buildingMats = [concreteMat, brickMat, plasterMat, damageMat];

  // Pre-bake building templates — assign a material variant per building family.
  // Target max dim ~1.3 so most buildings sit at 1.0–1.3u tall (≈10–13m in sim
  // scale, post-earthquake collapsed structures) — drones flying at 1.5u clear them.
  const buildingTemplates = [aptGlb.scene, facadeGlb.scene, mansionGlb.scene, multiGlb.scene].map((src, idx) => {
    const root = src.clone(true);
    const mat = buildingMats[idx % buildingMats.length];
    root.traverse((obj) => {
      if (obj.isMesh) obj.material = mat;
    });
    fitToSize(root, 1.3);
    return root;
  });

  // Swap blockades for rubble GLB
  for (const blk of scenario.map.blocked_cells) {
    const old = world.blockadeMeshes.get(blk.id);
    if (old) {
      world.scene.remove(old);
      old.traverse?.((obj) => {
        if (obj.isMesh) obj.geometry?.dispose?.();
      });
    }
    const rubble = rubbleGlb.scene.clone(true);
    rubble.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = obj.material.clone();
        if (obj.material.color) obj.material.color.setHex(0x6b4a2b);
        obj.material.roughness = 0.95;
        obj.material.metalness = 0.05;
      }
    });
    fitToSize(rubble, 1.4);
    rubble.position.set(blk.location[0] + 0.5, groundedY(rubble), blk.location[1] + 0.5);
    rubble.rotation.y = (blk.location[0] * 13 + blk.location[1] * 7) * 0.31;
    world.scene.add(rubble);
    world.blockadeMeshes.set(blk.id, rubble);
  }

  // Swap victims for survivor GLB (lying / posed)
  for (const v of scenario.victims) {
    const old = world.victimMeshes.get(v.id);
    if (old?.group) {
      world.scene.remove(old.group);
    }
    const survivor = survivorGlb.scene.clone(true);
    fitToSize(survivor, 0.9);
    const grp = new THREE.Group();
    grp.add(survivor);
    survivor.rotation.x = -Math.PI / 2;
    survivor.rotation.z = (v.id.charCodeAt(1) || 0) * 0.7;
    survivor.position.y = 0.05;
    const flare = new THREE.PointLight(0xff6666, 0.7, 4);
    flare.position.y = 0.4;
    grp.add(flare);
    grp.position.set(v.location[0] + 0.5, 0, v.location[1] + 0.5);

    const meshes = [];
    survivor.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = obj.material.clone();
        if (!obj.material.emissive) obj.material.emissive = new THREE.Color(0x000000);
        meshes.push(obj);
      }
    });
    world.scene.add(grp);
    world.victimMeshes.set(v.id, { group: grp, flare, meshes, isAsset: true });
  }

  // Scatter scenery — also reuse the rubble GLB for small debris piles
  scatterScenery(scenario, buildingTemplates, taxiGlb.scene, signsGlb.scene, rubbleGlb.scene);

  // Texture the ground
  if (world.groundGrid) {
    const groundBase = cBase.clone();
    const groundNorm = cNorm.clone();
    const groundRough = cRough.clone();
    for (const tex of [groundBase, groundNorm, groundRough]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(12, 12);
      tex.needsUpdate = true;
    }
    groundBase.colorSpace = THREE.SRGBColorSpace;
    world.groundGrid.material.dispose();
    world.groundGrid.material = new THREE.MeshStandardMaterial({
      map: groundBase,
      normalMap: groundNorm,
      roughnessMap: groundRough,
      color: 0x4a5562,
      roughness: 0.95,
      metalness: 0.05,
      emissive: 0x06121f,
      emissiveIntensity: 0.18
    });
  }
}

function scatterScenery(scenario, buildingTemplates, taxiSrc, signsSrc, rubbleSrc) {
  const { buildingCells, damagedCells } = buildCityBlocks(scenario, buildingTemplates);
  spillRubbleFromDamaged(scenario, damagedCells, rubbleSrc);
  addBurnedVehicles(scenario, taxiSrc);
  addCrackedRoadSlabs(scenario);
  addDustHaze(scenario);
  scatterStreetProps(scenario, taxiSrc, signsSrc, rubbleSrc, buildingCells);
}

function cellDamageLevel(cellX, cellY, riskZones) {
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

function cityOccupiedCells(scenario) {
  const occupied = new Set<string>();
  const mark = (x, y, r = 0) => {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        occupied.add(`${x + dx},${y + dy}`);
      }
    }
  };
  mark(scenario.map.base[0], scenario.map.base[1], 1);
  for (const v of scenario.victims) mark(v.location[0], v.location[1], 0);
  for (const b of scenario.map.blocked_cells) mark(b.location[0], b.location[1], 0);
  return occupied;
}

function hash01(x, y, salt = 0) {
  return Math.abs(Math.sin((x + salt * 1.7) * 12.9898 + (y + salt * 0.7) * 78.233) * 43758.5) % 1;
}

function placeRowBuilding(cellX, cellY, yaw, templates, damage = 0) {
  const tIdx = Math.floor(hash01(cellX, cellY, 0) * templates.length) % templates.length;
  const template = templates[tIdx];
  const b = template.clone(true);
  const bbox = new THREE.Box3().setFromObject(b);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const targetW = 0.98;
  const targetD = 0.98;
  let heightVar = 0.9 + hash01(cellX, cellY, 1) * 1.1;
  if (damage > 0.5) heightVar *= 0.3 + hash01(cellX, cellY, 3) * 0.4;
  b.scale.x *= targetW / Math.max(0.01, size.x);
  b.scale.z *= targetD / Math.max(0.01, size.z);
  b.scale.y *= heightVar / Math.max(0.01, size.y);
  b.rotation.y = yaw;
  if (damage > 0.5) {
    b.rotation.x = (hash01(cellX, cellY, 4) - 0.5) * 0.35;
    b.rotation.z = (hash01(cellX, cellY, 5) - 0.5) * 0.35;
  } else if (damage > 0.25) {
    const lean = 0.08 + hash01(cellX, cellY, 6) * 0.18;
    const sign = hash01(cellX, cellY, 7) > 0.5 ? 1 : -1;
    if (hash01(cellX, cellY, 8) > 0.5) b.rotation.x = lean * sign;
    else b.rotation.z = lean * sign;
  }
  b.position.set(cellX + 0.5, groundedY(b), cellY + 0.5);
  const baseTint = 0.85 + hash01(cellX, cellY, 2) * 0.25;
  const damageMul = damage > 0.5 ? 0.5 : damage > 0.25 ? 0.72 : 1.0;
  b.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      obj.material = obj.material.clone();
      if (obj.material.color) obj.material.color.multiplyScalar(baseTint * damageMul);
      if (damage > 0.5 && obj.material.roughness !== undefined) obj.material.roughness = Math.min(1, obj.material.roughness + 0.15);
    }
  });
  world.scene.add(b);
  if (damage < 0.25) addRoofGreebles(b, cellX, cellY);
}

function addRoofGreebles(building, cellX, cellY) {
  const bbox = new THREE.Box3().setFromObject(building);
  const top = bbox.max.y;
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cz = (bbox.min.z + bbox.max.z) / 2;
  const halfX = (bbox.max.x - bbox.min.x) / 2;
  const halfZ = (bbox.max.z - bbox.min.z) / 2;

  if (top < 0.7) return;

  const hvacMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.85, metalness: 0.25 });
  const hvac = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.22), hvacMat);
  hvac.position.set(
    cx + (hash01(cellX, cellY, 70) - 0.5) * halfX * 0.8,
    top + 0.05,
    cz + (hash01(cellX, cellY, 71) - 0.5) * halfZ * 0.8
  );
  hvac.rotation.y = Math.floor(hash01(cellX, cellY, 79) * 4) * (Math.PI / 2);
  world.scene.add(hvac);

  if (hash01(cellX, cellY, 72) > 0.45) {
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x6a5e52, roughness: 0.8, metalness: 0.1 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.2, 10), tankMat);
    tank.position.set(
      cx + (hash01(cellX, cellY, 73) - 0.5) * halfX * 0.7,
      top + 0.1,
      cz + (hash01(cellX, cellY, 74) - 0.5) * halfZ * 0.7
    );
    world.scene.add(tank);
  }

  if (hash01(cellX, cellY, 75) > 0.6) {
    const antMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.6 });
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.45, 5), antMat);
    ant.position.set(
      cx + (hash01(cellX, cellY, 76) - 0.5) * halfX * 0.7,
      top + 0.225,
      cz + (hash01(cellX, cellY, 77) - 0.5) * halfZ * 0.7
    );
    world.scene.add(ant);
  }

  if (hash01(cellX, cellY, 78) > 0.7) {
    const chimMat = new THREE.MeshStandardMaterial({ color: 0x4a3a32, roughness: 0.95 });
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), chimMat);
    chim.position.set(
      cx + (hash01(cellX, cellY, 80) - 0.5) * halfX * 0.8,
      top + 0.09,
      cz + (hash01(cellX, cellY, 81) - 0.5) * halfZ * 0.8
    );
    world.scene.add(chim);
  }
}

function buildCityBlocks(scenario, buildingTemplates) {
  const [cols, rows] = scenario.map.size;
  const occupied = cityOccupiedCells(scenario);
  const roadCells = computeRoadCells(scenario);
  const buildingCells = new Set<string>();
  const damagedCells = new Set<string>();
  const riskZones = scenario.map.risk_zones || [];

  const hLines = new Set<number>([0, rows - 1]);
  const vLines = new Set<number>([0, cols - 1]);
  for (const road of scenario.map.roads || []) {
    const pts = road.points;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a[1] === b[1]) hLines.add(a[1]);
      if (a[0] === b[0]) vLines.add(a[0]);
    }
  }
  const ys = Array.from(hLines).sort((a, b) => a - b);
  const xs = Array.from(vLines).sort((a, b) => a - b);

  for (let bi = 0; bi < ys.length - 1; bi += 1) {
    for (let bj = 0; bj < xs.length - 1; bj += 1) {
      const y0 = ys[bi];
      const y1 = ys[bi + 1];
      const x0 = xs[bj];
      const x1 = xs[bj + 1];
      const iy0 = y0 === 0 ? 0 : y0 + 1;
      const iy1 = y1 === rows - 1 ? rows - 1 : y1 - 1;
      const ix0 = x0 === 0 ? 0 : x0 + 1;
      const ix1 = x1 === cols - 1 ? cols - 1 : x1 - 1;
      if (ix1 < ix0 || iy1 < iy0) continue;

      for (let y = iy0; y <= iy1; y += 1) {
        for (let x = ix0; x <= ix1; x += 1) {
          const onTop = y === iy0;
          const onBot = y === iy1;
          const onLeft = x === ix0;
          const onRight = x === ix1;
          if (!(onTop || onBot || onLeft || onRight)) continue;
          if (occupied.has(`${x},${y}`)) continue;
          if (roadCells.has(`${x},${y}`)) continue;
          let yaw = 0;
          if (onTop) yaw = 0;
          else if (onBot) yaw = Math.PI;
          else if (onLeft) yaw = -Math.PI / 2;
          else yaw = Math.PI / 2;
          const damage = cellDamageLevel(x, y, riskZones);
          placeRowBuilding(x, y, yaw, buildingTemplates, damage);
          buildingCells.add(`${x},${y}`);
          if (damage > 0.25) damagedCells.add(`${x},${y}`);
        }
      }
    }
  }
  return { buildingCells, damagedCells };
}

function spillRubbleFromDamaged(scenario, damagedCells, rubbleSrc) {
  if (!rubbleSrc || damagedCells.size === 0) return;
  const [cols, rows] = scenario.map.size;
  const roadCells = computeRoadCells(scenario);
  const placed = new Set<string>();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const key of damagedCells) {
    const [cxStr, cyStr] = key.split(",");
    const cx = Number(cxStr);
    const cy = Number(cyStr);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nkey = `${nx},${ny}`;
      if (!roadCells.has(nkey)) continue;
      if (placed.has(nkey)) continue;
      if (hash01(nx, ny, 11) > 0.55) continue;
      const debris = rubbleSrc.clone(true);
      fitToSize(debris, 0.5 + hash01(nx, ny, 12) * 0.4);
      const jitterX = (hash01(nx, ny, 13) - 0.5) * 0.5;
      const jitterZ = (hash01(nx, ny, 14) - 0.5) * 0.5;
      debris.position.set(nx + 0.5 + jitterX, groundedY(debris), ny + 0.5 + jitterZ);
      debris.rotation.y = hash01(nx, ny, 15) * Math.PI * 2;
      debris.rotation.z = (hash01(nx, ny, 16) - 0.5) * 0.3;
      debris.traverse((obj) => {
        if (obj.isMesh) {
          obj.material = obj.material.clone();
          if (obj.material.color) obj.material.color.setHex(0x5a4838);
          obj.material.roughness = 0.95;
        }
      });
      world.scene.add(debris);
      placed.add(nkey);
    }
  }
}

function addBurnedVehicles(scenario, taxiSrc) {
  if (!taxiSrc) return;
  const fireZones = (scenario.map.risk_zones || []).filter((z) => z.type === "fire");
  if (fireZones.length === 0) return;
  const roadCells = computeRoadCells(scenario);
  const placed = new Set<string>();
  for (const z of fireZones) {
    const r = Math.ceil(z.radius + 1);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        const cx = z.center[0] + dx;
        const cy = z.center[1] + dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > z.radius + 1.5) continue;
        const key = `${cx},${cy}`;
        if (!roadCells.has(key)) continue;
        if (placed.has(key)) continue;
        if (hash01(cx, cy, 21) > 0.4) continue;
        const taxi = taxiSrc.clone(true);
        fitToSize(taxi, 0.7);
        taxi.rotation.y = hash01(cx, cy, 22) * Math.PI * 2;
        if (hash01(cx, cy, 23) > 0.55) taxi.rotation.z = Math.PI / 2 + (hash01(cx, cy, 24) - 0.5) * 0.4;
        taxi.position.set(cx + 0.5, groundedY(taxi), cy + 0.5);
        taxi.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            obj.material = obj.material.clone();
            if (obj.material.color) obj.material.color.setHex(0x1c1612);
            obj.material.roughness = 0.95;
            obj.material.metalness = 0.2;
          }
        });
        world.scene.add(taxi);
        placed.add(key);
      }
    }
  }
}

function addCrackedRoadSlabs(scenario) {
  const collapseZones = (scenario.map.risk_zones || []).filter((z) => z.type === "collapse");
  if (collapseZones.length === 0) return;
  const roadCells = computeRoadCells(scenario);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.95, metalness: 0.05 });
  for (const z of collapseZones) {
    const r = Math.ceil(z.radius);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        const cx = z.center[0] + dx;
        const cy = z.center[1] + dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > z.radius) continue;
        if (!roadCells.has(`${cx},${cy}`)) continue;
        if (hash01(cx, cy, 31) > 0.45) continue;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.4), slabMat);
        const jx = (hash01(cx, cy, 32) - 0.5) * 0.5;
        const jz = (hash01(cx, cy, 33) - 0.5) * 0.5;
        slab.position.set(cx + 0.5 + jx, 0.18, cy + 0.5 + jz);
        slab.rotation.x = (hash01(cx, cy, 34) - 0.5) * 0.8;
        slab.rotation.y = hash01(cx, cy, 35) * Math.PI * 2;
        slab.rotation.z = (hash01(cx, cy, 36) - 0.5) * 0.8;
        world.scene.add(slab);
      }
    }
  }
}

function addDustHaze(scenario) {
  const zones = scenario.map.risk_zones || [];
  for (const z of zones) {
    const isFire = z.type === "fire";
    const color = isFire ? 0x5a3a1a : 0x4a4035;
    const haze = new THREE.Mesh(
      new THREE.CylinderGeometry(z.radius + 0.6, z.radius + 0.6, 0.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: true })
    );
    haze.position.set(z.center[0] + 0.5, 0.3, z.center[1] + 0.5);
    world.scene.add(haze);
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(z.radius + 0.6, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, fog: true })
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.set(z.center[0] + 0.5, 0.6, z.center[1] + 0.5);
    world.scene.add(cap);
  }
}

function scatterStreetProps(scenario, taxiSrc, signsSrc, rubbleSrc, buildingCells) {
  const [cols, rows] = scenario.map.size;
  const occupied = cityOccupiedCells(scenario);
  const roadCells = computeRoadCells(scenario);
  const cardinalRot = (x, y) => Math.floor(hash01(x, y + 5) * 4) * (Math.PI / 2);

  for (let x = 1; x < cols - 1; x += 1) {
    for (let y = 1; y < rows - 1; y += 1) {
      const key = `${x},${y}`;
      if (occupied.has(key)) continue;
      if (buildingCells.has(key)) continue;
      if (roadCells.has(key)) {
        const rr = hash01(x + 7, y - 3);
        if (rr < 0.05 && taxiSrc) {
          const taxi = taxiSrc.clone(true);
          fitToSize(taxi, 0.7);
          taxi.position.set(x + 0.5, groundedY(taxi), y + 0.5);
          taxi.rotation.y = cardinalRot(x + 1, y);
          world.scene.add(taxi);
        } else if (rr < 0.09 && signsSrc) {
          const sign = signsSrc.clone(true);
          fitToSize(sign, 0.5);
          sign.position.set(x + 0.5, groundedY(sign), y + 0.5);
          sign.rotation.y = cardinalRot(x + 2, y);
          world.scene.add(sign);
        }
        continue;
      }
      const r = hash01(x, y);
      if (r < 0.35 && rubbleSrc) {
        const debris = rubbleSrc.clone(true);
        fitToSize(debris, 0.55 + hash01(x, y + 8) * 0.4);
        debris.position.set(x + 0.5, groundedY(debris), y + 0.5);
        debris.rotation.y = hash01(x + 5, y) * Math.PI * 2;
        debris.traverse((obj) => {
          if (obj.isMesh) {
            obj.material = obj.material.clone();
            if (obj.material.color) obj.material.color.setHex(0x554840);
            obj.material.roughness = 0.95;
          }
        });
        world.scene.add(debris);
      } else if (r < 0.5 && signsSrc) {
        const sign = signsSrc.clone(true);
        fitToSize(sign, 0.5);
        sign.position.set(x + 0.5, groundedY(sign), y + 0.5);
        sign.rotation.y = cardinalRot(x + 2, y);
        world.scene.add(sign);
      }
    }
  }
}

function makeGridTexture(size, cols, rows) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#02060f";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgba(0, 180, 255, 0.45)";
  g.lineWidth = 1.2;
  for (let i = 0; i <= cols; i += 1) {
    const x = (i / cols) * size;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, size);
    g.stroke();
  }
  for (let i = 0; i <= rows; i += 1) {
    const y = (i / rows) * size;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y);
    g.stroke();
  }
  // Sparse "tile" highlights
  g.fillStyle = "rgba(0, 191, 255, 0.06)";
  for (let i = 0; i < 40; i += 1) {
    const cx = Math.floor(Math.random() * cols);
    const cy = Math.floor(Math.random() * rows);
    g.fillRect((cx / cols) * size + 1, (cy / rows) * size + 1, size / cols - 2, size / rows - 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function update3D(t) {
  if (!world.initialized || !state) return;
  const frac = Math.min(1, Math.max(0, (performance.now() - lastTickAt) / MS_PER_TICK));
  updateSmokeAndGlows(t);

  // ── Shared scene updates ────────────────────────────────────────────────
  for (const a of state.agents) {
    const mesh = world.agentMeshes.get(a.id);
    if (!mesh) continue;
    const prev = a.prevLocation || a.location;
    const ix = lerp(prev[0], a.location[0], frac);
    const iy = lerp(prev[1], a.location[1], frac);
    const targetY = a.type === "drone" ? 1.5 + Math.sin(t * 1.0 + a.id.charCodeAt(0)) * 0.5 + Math.sin(t * 0.4 + a.id.charCodeAt(0) * 0.5) * 0.25 : 0;
    mesh.position.set(ix + 0.5, targetY, iy + 0.5);

    const dx = a.location[0] - prev[0];
    const dy = a.location[1] - prev[1];
    if (Math.abs(dx) + Math.abs(dy) > 0.001) {
      const yaw = Math.atan2(dx, dy);
      mesh.rotation.y = lerp(mesh.rotation.y, yaw, 0.15);
    }

    if (mesh.userData.rotors) {
      for (let i = 0; i < mesh.userData.rotors.length; i += 1) {
        mesh.userData.rotors[i].rotation.y = t * 30 + i * 0.5;
      }
    }
    if (mesh.userData.navLight) {
      const blink = 0.5 + 0.5 * Math.sin(t * 6 + a.id.charCodeAt(0));
      mesh.userData.navLight.intensity = a.type === "drone" ? 1.4 + blink * 0.6 : 0.9 + blink * 0.3;
    }
    if (mesh.userData.beacon) {
      const pulse = (Math.sin(t * 4.5 + a.id.charCodeAt(0)) + 1) * 0.5;
      const m = mesh.userData.beacon.material;
      if (m && m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6 + pulse * 4;
    }
    if (mesh.userData.statusRing) {
      const slow = (Math.sin(t * 1.2 + a.id.charCodeAt(0)) + 1) * 0.5;
      const m = mesh.userData.statusRing.material;
      if (m && m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6 + slow * 1.4;
    }
  }

  for (const v of state.victims) {
    const m = world.victimMeshes.get(v.id);
    if (!m) continue;
    const isAlive = v.status === "trapped" || v.status === "unknown";
    const color = v.status === "rescued" ? 0x39ff14 : v.status === "dead" ? 0x444444 : 0xff6666;
    if (m.flare) {
      m.flare.color.setHex(color);
      m.flare.intensity = isAlive ? 0.5 + 0.5 * (Math.sin(t * 4 + v.id.charCodeAt(1) * 0.3) * 0.5 + 0.5) : 0.15;
    }
    if (m.isAsset && m.meshes) {
      const emit = isAlive ? 0.35 : v.status === "rescued" ? 0.6 : 0.05;
      for (const mesh of m.meshes) {
        if (mesh.material.emissive) {
          mesh.material.emissive.setHex(color);
          mesh.material.emissiveIntensity = emit;
        }
      }
    } else if (m.post && m.arm) {
      m.post.material.color.setHex(color);
      m.post.material.emissive.setHex(color);
      m.arm.material.color.setHex(color);
      m.arm.material.emissive.setHex(color);
    }
    if (m.group) {
      m.group.position.y = isAlive ? Math.abs(Math.sin(t * 2)) * 0.05 : 0;
    }
  }

  for (const [, rz] of world.riskMeshes) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.2);
    if (rz.ring) rz.ring.material.opacity = 0.18 + pulse * 0.12;
    if (rz.halo) rz.halo.intensity = (rz.isFire ? 0.5 : 0.3) + pulse * 0.4;
    if (rz.column) {
      rz.column.material.opacity = 0.12 + Math.sin(t * 2.4) * 0.04 + 0.06 * pulse;
      rz.column.rotation.y = t * 0.25;
    }
  }

  for (const blk of state.map.blocked_cells) {
    const node = world.blockadeMeshes.get(blk.id);
    if (!node) continue;
    const cleared = blk.status === "cleared";
    if (node.isMesh) {
      if (cleared) {
        node.material.transparent = true;
        node.material.opacity = Math.max(0.05, (node.material.opacity ?? 1) - 0.02);
        node.material.color.setHex(0x39ff14);
        node.scale.y = Math.max(0.05, node.scale.y - 0.01);
        node.position.y = 0.6 * node.scale.y;
      } else {
        node.material.transparent = false;
        node.material.opacity = 1;
        node.material.color.setHex(0x8b4513);
        const progress = blk.clear_progress / blk.repair_cost;
        node.scale.y = Math.max(0.2, 1 - progress * 0.6);
        node.position.y = 0.6 * node.scale.y;
      }
    } else {
      const targetOpacity = cleared ? 0.15 : 1;
      node.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = targetOpacity < 1;
          const cur = obj.material.opacity ?? 1;
          obj.material.opacity = cur + (targetOpacity - cur) * 0.05;
        }
      });
    }
  }

  // ── Per-POV camera + render ─────────────────────────────────────────────
  for (const entry of povs) {
    const driver = state.agents.find((a) => a.id === entry.selectedId) || state.agents[0];
    if (!driver) continue;
    const prev = driver.prevLocation || driver.location;
    const ix = lerp(prev[0], driver.location[0], frac);
    const iy = lerp(prev[1], driver.location[1], frac);

    const phaseSeed = driver.id.charCodeAt(0) * 0.13;
    // Drones: base 1.5 + dual-sine vertical wander (matches drone mesh).
    // UGVs: 0.45 — sensor turret height, so the camera sits where the lens lives.
    const altitude = driver.type === "drone"
      ? 1.5 + Math.sin(t * 1.0 + driver.id.charCodeAt(0)) * 0.5 + Math.sin(t * 0.4 + driver.id.charCodeAt(0) * 0.5) * 0.25
      : 0.45;
    const headBobX = driver.type === "drone" ? Math.sin(t * 1.6 + phaseSeed) * 0.05 : 0;
    const headBobY = driver.type === "drone" ? Math.sin(t * 2.2 + phaseSeed) * 0.04 : 0;
    const targetPos = new THREE.Vector3(ix + 0.5 + headBobX, altitude + headBobY, iy + 0.5);

    const target = currentTargetFor(driver);
    // Drones look strongly down at the ground (surveying for survivors).
    // UGVs look slightly forward-down (mid-distance for path scanning).
    const pitch = driver.type === "drone" ? -0.45 : -0.1;
    const fwd = new THREE.Vector3();
    if (target) {
      fwd.set(target[0] + 0.5 - (ix + 0.5), pitch, target[1] + 0.5 - (iy + 0.5));
    } else {
      const dx = driver.location[0] - prev[0];
      const dy = driver.location[1] - prev[1];
      if (Math.abs(dx) + Math.abs(dy) < 0.001) {
        fwd.set(Math.cos(t * 0.3 + phaseSeed), pitch, Math.sin(t * 0.3 + phaseSeed));
      } else {
        fwd.set(dx, pitch, dy);
      }
    }
    fwd.normalize();
    const lookAt = targetPos.clone().add(fwd.multiplyScalar(3));

    entry.smoothPos.lerp(targetPos, 0.18);
    entry.smoothLook.lerp(lookAt, 0.12);
    entry.camera.position.copy(entry.smoothPos);
    entry.camera.lookAt(entry.smoothLook);

    // HUD telemetry
    const vel = Math.hypot(driver.location[0] - prev[0], driver.location[1] - prev[1]) / (MS_PER_TICK / 1000);
    entry.smoothVel = lerp(entry.smoothVel, vel, 0.15);
    const hdgRad = Math.atan2(driver.location[0] - prev[0], driver.location[1] - prev[1]);
    const hdgDeg = ((hdgRad * 180) / Math.PI + 360) % 360;
    entry.smoothHdg = lerpAngleDeg(entry.smoothHdg, hdgDeg, 0.12);

    if (entry.hud.alt) entry.hud.alt.textContent = (altitude + headBobY).toFixed(1);
    if (entry.hud.hdg) entry.hud.hdg.textContent = String(Math.round(entry.smoothHdg)).padStart(3, "0");
    if (entry.hud.vel) entry.hud.vel.textContent = entry.smoothVel.toFixed(1);
    if (entry.hud.pwr) entry.hud.pwr.textContent = `${Math.round(driver.battery)}%`;
    if (entry.hud.target) {
      const targetId = currentTargetIdFor(driver);
      entry.hud.target.textContent = targetId ? `TGT ${targetId}` : "TGT —";
    }

    // Hide own driver for this POV only, then restore for others
    for (const [id, m] of world.agentMeshes) m.visible = id !== driver.id;
    entry.renderer.render(world.scene, entry.camera);
  }

  // Restore all agent visibility (the 2D canvas / other code doesn't care, but be safe)
  for (const m of world.agentMeshes.values()) m.visible = true;
}

function lerpAngleDeg(a, b, t) {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

function currentTargetFor(agent) {
  if (!plan || !plan.mission_plan) return null;
  const action = plan.mission_plan.find((m) => m.agent === agent.id);
  if (!action) return null;
  if (!action.target) return null;
  if (action.target.startsWith("V")) {
    const v = state.victims.find((vv) => vv.id === action.target);
    return v ? v.location : null;
  }
  if (action.target.startsWith("K")) {
    const b = state.map.blocked_cells.find((bb) => bb.id === action.target);
    return b ? b.location : null;
  }
  if (action.target === "Relay-R1") return [14, 7];
  return null;
}

function currentTargetIdFor(agent) {
  if (!plan || !plan.mission_plan) return null;
  const action = plan.mission_plan.find((m) => m.agent === agent.id);
  return action ? action.target : null;
}


  return () => {
    stepBtn.removeEventListener("click", step);
    resetBtn.removeEventListener("click", reset);
    autoBtn.removeEventListener("click", onAutoToggle);
    document.removeEventListener("keydown", handleGlobalSelectorKey);
    stopAuto();
    if (typewriterTimer !== null) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const entry of povs) {
      entry.ro?.disconnect();
      if (entry.renderer) {
        entry.renderer.dispose();
        entry.renderer = null;
      }
    }
    povs.length = 0;
    world.initialized = false;
  };
}
