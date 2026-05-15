import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const canvas = document.querySelector("#simCanvas");
const ctx = canvas.getContext("2d");
const tickLabel = document.querySelector("#tickLabel");
const rescuedCount = document.querySelector("#rescuedCount");
const priorityList = document.querySelector("#priorityList");
const agentList = document.querySelector("#agentList");
const briefText = document.querySelector("#briefText");
const missionJson = document.querySelector("#missionJson");
const stepBtn = document.querySelector("#stepBtn");
const autoBtn = document.querySelector("#autoBtn");
const resetBtn = document.querySelector("#resetBtn");
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
const TRAIL_LEN = 10;
const MS_PER_TICK = 900;
const MAX_EVENT_LOG = 20;
let typewriterTimer = null;
const TOAST_STYLES = {
  rescued:          { color: "#5dffb4", bg: "rgba(14,16,20,0.92)" },
  victim_dead:      { color: "#ff5d6c", bg: "rgba(14,16,20,0.92)" },
  blockade_cleared: { color: "#ffd95d", bg: "rgba(14,16,20,0.92)" },
  relay_deployed:   { color: "#c8b4ff", bg: "rgba(14,16,20,0.92)" },
  default:          { color: "#82c8ff", bg: "rgba(14,16,20,0.92)" }
};
function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

fetch("/demo/scenario_001.json")
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

  drawGrid(cols, rows, cell);
  drawCommunication(cell, t);
  drawRiskZones(cell, t);
  drawBlockades(cell);
  drawVictims(cell, t);
  drawBase(cell);
  drawAgents(cell, t);
}

function drawGrid(cols, rows, cell) {
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
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
  ctx.fillStyle = "rgba(60, 80, 110, 0.32)";
  for (let y = 2; y < rows; y += 5) ctx.fillRect(0, y * cell + cell * 0.28, canvas.width, cell * 0.44);
  for (let x = 2; x < cols; x += 6) ctx.fillRect(x * cell + cell * 0.28, 0, cell * 0.44, canvas.height);
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
    ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
    const label = zone.type.toUpperCase();
    ctx.fillText(label, px - label.length * 2.7, py + 3);
  }
}

function drawBlockades(cell) {
  for (const blockade of state.map.blocked_cells) {
    const [x, y] = blockade.location;
    if (blockade.status === "cleared") {
      ctx.fillStyle = "rgba(93,255,180,0.08)";
      ctx.fillRect(x * cell, y * cell, cell, cell);
      continue;
    }
    ctx.fillStyle = "rgba(139,69,19,0.5)";
    ctx.fillRect(x * cell, y * cell, cell, cell);
    ctx.strokeStyle = "#8b4513";
    ctx.lineWidth = 1;
    ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    ctx.fillStyle = "#a0522d";
    ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
    ctx.fillText("BLK", x * cell + 2, y * cell + cell / 2 + 3);
    const progress = blockade.clear_progress / blockade.repair_cost;
    ctx.fillStyle = "#ffd95d";
    ctx.fillRect(x * cell + 3, y * cell + cell - 5, (cell - 6) * progress, 2);
  }
}

function drawVictims(cell, t) {
  for (const victim of state.victims) {
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
      ctx.save();
      ctx.globalAlpha = 0.18 * halo;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowBlur = victim.status === "trapped" ? 8 : 3;
    ctx.shadowColor = color;
    const armW = Math.max(2, cell * 0.1);
    const armL = Math.max(8, cell * 0.4);
    ctx.fillRect(px - armW / 2, py - armL / 2, armW, armL);
    ctx.fillRect(px - armL / 2, py - armW / 2, armL, armW);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = color;
    ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
    ctx.fillText(victim.id, px - 8, py - cell * 0.42);

    if (victim.status === "trapped" || victim.status === "unknown") {
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
  ctx.strokeStyle = "#ffd95d";
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ffd95d";
  ctx.strokeRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffd95d";
  ctx.font = "bold 9px 'JetBrains Mono', 'Courier New', monospace";
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
      drawUAV(px, py, cell, battery, agent.perception_range || 4, t, trail);
    } else {
      drawUGV(px, py, cell, battery, t, trail);
    }
    drawAgentLabel(agent.id, px, py, agent.type === "drone" ? "#82c8ff" : "#5dffb4");
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

function drawUAV(px, py, cell, battery, scanRange, t, trail) {
  const color = "rgb(130,200,255)";
  drawTrail(trail, cell, color);

  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, scanRange * cell, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(130,200,255,0.25)";
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -t * 10;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(130,200,255,0.04)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(t * 8);
  ctx.strokeStyle = "#82c8ff";
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#82c8ff";
  const arm = Math.min(8, cell * 0.4);
  const rotor = Math.max(2, cell * 0.13);
  for (let i = 0; i < 4; i += 1) {
    ctx.rotate(Math.PI / 2);
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
  ctx.fillStyle = "#82c8ff";
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : "#82c8ff";
  ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawUGV(px, py, cell, battery, t, trail) {
  const color = "rgb(93,255,180)";

  if (trail && trail.length > 1) {
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -t * 8;
    for (let i = 1; i < trail.length; i += 1) {
      const a = trail[i - 1];
      const b = trail[i];
      const alpha = (i / trail.length) * 0.45;
      ctx.strokeStyle = `rgba(57,255,20,${alpha})`;
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
  ctx.strokeStyle = "#5dffb4";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(px - half, py - half, body, body);
  ctx.fillStyle = "rgba(93,255,180,0.18)";
  ctx.fillRect(px - half, py - half, body, body);
  ctx.fillStyle = "#5dffb4";
  const trackW = Math.max(2, body * 0.18);
  ctx.fillRect(px - half - trackW - 1, py - half + 1, trackW, body - 2);
  ctx.fillRect(px + half + 1, py - half + 1, trackW, body - 2);
  ctx.beginPath();
  ctx.arc(px, py, Math.max(1.5, body * 0.16), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : "#5dffb4";
  ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawAgentLabel(id, px, py, color) {
  ctx.fillStyle = color;
  ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
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

  chartCtx.strokeStyle = "rgba(130,200,255,0.12)";
  chartCtx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i += 1) {
    const y = (H - 20) * (i / 4) + 4;
    chartCtx.beginPath();
    chartCtx.moveTo(28, y);
    chartCtx.lineTo(W - 8, y);
    chartCtx.stroke();
  }
  chartCtx.fillStyle = "rgba(130,200,255,0.55)";
  chartCtx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
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
  chartCtx.fillStyle = "rgba(93,255,180,0.18)";
  chartCtx.fill();

  chartCtx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const x = xAt(i);
    const y = yAt(survivalHistory[i].alive);
    if (i === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  }
  chartCtx.strokeStyle = "#5dffb4";
  chartCtx.lineWidth = 1.5;
  chartCtx.shadowBlur = 6;
  chartCtx.shadowColor = "#5dffb4";
  chartCtx.stroke();
  chartCtx.shadowBlur = 0;

  chartCtx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const x = xAt(i);
    const y = yAt(survivalHistory[i].rescued);
    if (i === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  }
  chartCtx.strokeStyle = "#82c8ff";
  chartCtx.lineWidth = 1.2;
  chartCtx.setLineDash([4, 3]);
  chartCtx.stroke();
  chartCtx.setLineDash([]);

  chartCtx.fillStyle = "#5dffb4";
  chartCtx.fillText("alive", W - 78, H - 4);
  chartCtx.fillStyle = "#82c8ff";
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

stepBtn.addEventListener("click", step);
resetBtn.addEventListener("click", reset);
autoBtn.addEventListener("click", () => {
  if (timer) {
    stopAuto();
    return;
  }
  autoBtn.textContent = "Pause";
  timer = setInterval(step, 900);
});

/* ──────────────────────────────────────────────────────────────────────────
   3D first-person view
   ────────────────────────────────────────────────────────────────────────── */

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

  // Sky-dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x05101f, side: THREE.BackSide, fog: false })
  );
  world.scene.add(sky);

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
        style: "padding: 16px; color: #ffd95d; font-size: 10px; text-align: center;",
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

  const M = "/models/";
  const T = "/textures/";

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
  const [cols, rows] = scenario.map.size;
  const occupied = new Set();
  const mark = (x, y, r = 1) => {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        occupied.add(`${x + dx},${y + dy}`);
      }
    }
  };
  mark(scenario.map.base[0], scenario.map.base[1], 2);
  for (const v of scenario.victims) mark(v.location[0], v.location[1], 2);
  for (const b of scenario.map.blocked_cells) mark(b.location[0], b.location[1], 1);
  for (const z of scenario.map.risk_zones) {
    const r = Math.ceil(z.radius);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (dx * dx + dy * dy <= z.radius * z.radius) {
          occupied.add(`${z.center[0] + dx},${z.center[1] + dy}`);
        }
      }
    }
  }

  const hash = (x, y) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5) % 1;
  const cardinalRot = (x, y) => Math.floor(hash(x, y + 5) * 4) * (Math.PI / 2);

  // Road cells (open spine every 5th row / 6th col) — skip placement here so streets stay clear
  const isRoad = (x, y) => (y % 5 === 2) || (x % 6 === 2);

  for (let x = 1; x < cols - 1; x += 1) {
    for (let y = 1; y < rows - 1; y += 1) {
      if (occupied.has(`${x},${y}`)) continue;
      if (isRoad(x, y)) {
        // Street props: lower-frequency taxis and signs in roads
        const rr = hash(x + 7, y - 3);
        if (rr < 0.04 && taxiSrc) {
          const taxi = taxiSrc.clone(true);
          fitToSize(taxi, 0.7);
          taxi.position.set(x + 0.5, groundedY(taxi), y + 0.5);
          taxi.rotation.y = cardinalRot(x + 1, y);
          world.scene.add(taxi);
        } else if (rr < 0.07 && signsSrc) {
          const sign = signsSrc.clone(true);
          fitToSize(sign, 0.5);
          sign.position.set(x + 0.5, groundedY(sign), y + 0.5);
          sign.rotation.y = cardinalRot(x + 2, y);
          world.scene.add(sign);
        }
        continue;
      }
      const r = hash(x, y);
      if (r < 0.32) {
        const idx = Math.floor(hash(x + 3, y - 2) * buildingTemplates.length);
        const b = buildingTemplates[idx].clone(true);
        b.position.set(x + 0.5, groundedY(b), y + 0.5);
        b.rotation.y = cardinalRot(x, y);
        world.scene.add(b);
        mark(x, y, 1);
      } else if (r < 0.42 && rubbleSrc) {
        // Small debris pile in vacant lots
        const debris = rubbleSrc.clone(true);
        fitToSize(debris, 0.6 + hash(x, y + 8) * 0.4);
        debris.position.set(x + 0.5, groundedY(debris), y + 0.5);
        debris.rotation.y = hash(x + 5, y) * Math.PI * 2;
        debris.traverse((obj) => {
          if (obj.isMesh) {
            obj.material = obj.material.clone();
            if (obj.material.color) obj.material.color.setHex(0x554840);
            obj.material.roughness = 0.95;
          }
        });
        world.scene.add(debris);
      } else if (r < 0.45 && signsSrc) {
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
  g.fillStyle = "#04060a";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgba(93, 255, 180, 0.32)";
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
  g.fillStyle = "rgba(130, 200, 255, 0.06)";
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

