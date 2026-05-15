// @ts-nocheck
// Ported from static app.js; gradual typing would be a large follow-up.

import * as THREE from "three";

export function initLiteSim(): () => void {
  let resizeObserver: ResizeObserver | null = null;

const canvas = document.querySelector("#simCanvas") as HTMLCanvasElement | null;
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
const stepBtn = document.querySelector("#stepBtn") as HTMLButtonElement | null;
const autoBtn = document.querySelector("#autoBtn") as HTMLButtonElement | null;
const resetBtn = document.querySelector("#resetBtn") as HTMLButtonElement | null;
if (!stepBtn || !autoBtn || !resetBtn) {
  return () => {};
}
const survivalChart = document.querySelector("#survivalChart") as HTMLCanvasElement | null;
const chartCtx = survivalChart ? survivalChart.getContext("2d") : null;
const survivalHistory: { t: number; alive: number; rescued: number }[] = [];

const povCanvas = document.querySelector("#povCanvas") as HTMLCanvasElement | null;
const droneSwitcher = document.querySelector("#droneSwitcher");
const hudAlt = document.querySelector("#hudAlt");
const hudHdg = document.querySelector("#hudHdg");
const hudVel = document.querySelector("#hudVel");
const hudPwr = document.querySelector("#hudPwr");
const hudTarget = document.querySelector("#hudTarget");

let selectedDroneId = "Drone-1";
const pov = {
  renderer: null,
  scene: null,
  camera: null,
  agentMeshes: new Map(),
  victimMeshes: new Map(),
  blockadeMeshes: new Map(),
  riskMeshes: new Map(),
  baseMesh: null,
  groundGrid: null,
  smoothPos: new THREE.Vector3(),
  smoothLook: new THREE.Vector3(),
  smoothHdg: 0,
  smoothVel: 0,
  initialized: false
};

let initialScenario;
let state;
let timer: ReturnType<typeof setInterval> | null = null;
let plan = null;
let rafId: number | null = null;
let lastTickAt = 0;
const T0 = performance.now();
const trails = new Map<string, { x: number; y: number }[]>();
const TRAIL_LEN = 10;
const MS_PER_TICK = 900;
const MAX_EVENT_LOG = 20;
let typewriterTimer: ReturnType<typeof setInterval> | null = null;
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
    populateDroneSwitcher(scenario);
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
  ctx.fillStyle = "#020812";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(0, 120, 200, 0.12)";
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
  ctx.fillStyle = "rgba(30, 58, 85, 0.55)";
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
    const color = victim.status === "rescued"
      ? "#39ff14"
      : victim.status === "dead"
        ? "#555555"
        : "#ff6666";

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
    ctx.font = "9px 'Courier New', monospace";
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
      drawUAV(px, py, cell, battery, agent.perception_range || 4, t, trail);
    } else {
      drawUGV(px, py, cell, battery, t, trail);
    }
    drawAgentLabel(agent.id, px, py, agent.type === "drone" ? "#00bfff" : "#39ff14");
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
  const color = "rgb(0,191,255)";
  drawTrail(trail, cell, color);

  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, scanRange * cell, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,191,255,0.25)";
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -t * 10;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(0,191,255,0.04)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(t * 8);
  ctx.strokeStyle = "#00bfff";
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#00bfff";
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
  ctx.fillStyle = "#00bfff";
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = battery < 0.15 ? "#ff4444" : battery < 0.3 ? "#ff8c00" : "#00bfff";
  ctx.font = "9px 'Courier New', monospace";
  ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawUGV(px, py, cell, battery, t, trail) {
  const color = "rgb(57,255,20)";

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
  ctx.strokeStyle = "#39ff14";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(px - half, py - half, body, body);
  ctx.fillStyle = "rgba(57,255,20,0.18)";
  ctx.fillRect(px - half, py - half, body, body);
  ctx.fillStyle = "#39ff14";
  const trackW = Math.max(2, body * 0.18);
  ctx.fillRect(px - half - trackW - 1, py - half + 1, trackW, body - 2);
  ctx.fillRect(px + half + 1, py - half + 1, trackW, body - 2);
  ctx.beginPath();
  ctx.arc(px, py, Math.max(1.5, body * 0.16), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = battery < 0.15 ? "#ff4444" : battery < 0.3 ? "#ff8c00" : "#39ff14";
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
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  autoBtn.textContent = "Run";
}

/* ──────────────────────────────────────────────────────────────────────────
   3D first-person view
   ────────────────────────────────────────────────────────────────────────── */

function init3D(scenario) {
  if (!povCanvas || pov.initialized) return;
  const [cols, rows] = scenario.map.size;

  try {
    pov.renderer = new THREE.WebGLRenderer({ canvas: povCanvas, antialias: true, alpha: false });
  } catch (errFromRenderer: unknown) {
    console.warn("WebGL unavailable — FPV viewport disabled.", errFromRenderer);
    return;
  }
  pov.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  pov.renderer.setClearColor(0x02060f, 1);

  pov.scene = new THREE.Scene();
  pov.scene.fog = new THREE.Fog(0x02060f, 12, 55);

  pov.camera = new THREE.PerspectiveCamera(72, 16 / 10, 0.1, 200);
  pov.camera.position.set(cols / 2, 2.2, rows / 2);
  pov.camera.lookAt(cols / 2 + 1, 1.5, rows / 2);
  pov.smoothPos.copy(pov.camera.position);
  pov.smoothLook.set(cols / 2 + 1, 1.5, rows / 2);

  // Ambient + key + rim lighting
  pov.scene.add(new THREE.HemisphereLight(0x4f80ff, 0x0a0f1a, 0.55));
  const key = new THREE.DirectionalLight(0xb8d8ff, 0.85);
  key.position.set(20, 30, 10);
  pov.scene.add(key);
  const rim = new THREE.PointLight(0x00bfff, 1.2, 60);
  rim.position.set(cols / 2, 14, rows / 2);
  pov.scene.add(rim);

  // Ground with neon grid (CanvasTexture)
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
  pov.scene.add(ground);
  pov.groundGrid = ground;

  // Sky-dome (large inverted sphere with gradient via vertex colors)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x05101f, side: THREE.BackSide, fog: false })
  );
  pov.scene.add(sky);

  // Base marker — yellow glowing pad
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
  pov.scene.add(base);
  pov.baseMesh = base;

  // Blockades — brown boxes
  for (const blk of scenario.map.blocked_cells) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.85, metalness: 0.1 })
    );
    mesh.position.set(blk.location[0] + 0.5, 0.6, blk.location[1] + 0.5);
    pov.scene.add(mesh);
    pov.blockadeMeshes.set(blk.id, mesh);
  }

  // Risk zones — flat disks with emissive glow
  for (const zone of scenario.map.risk_zones) {
    const isFire = zone.type === "fire";
    const baseColor = isFire ? 0xff3c00 : 0xa887ff;
    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(zone.radius, 32),
      new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        fog: false
      })
    );
    disk.rotation.x = -Math.PI / 2;
    disk.position.set(zone.center[0] + 0.5, 0.02, zone.center[1] + 0.5);
    pov.scene.add(disk);

    const halo = new THREE.PointLight(baseColor, 0.6, zone.radius * 3.5);
    halo.position.set(zone.center[0] + 0.5, 1.8, zone.center[1] + 0.5);
    pov.scene.add(halo);

    pov.riskMeshes.set(zone.id, { disk, halo, baseColor, isFire });
  }

  // Victims — small cross/totem shapes
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
    pov.scene.add(grp);
    pov.victimMeshes.set(v.id, { group: grp, post, arm, flare });
  }

  // Agents — every agent gets a body so you can see your teammates from FPV
  for (const a of scenario.agents) {
    const grp = new THREE.Group();
    if (a.type === "drone") {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.08, 0.32),
        new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7, roughness: 0.3 })
      );
      grp.add(body);
      const rotorMat = new THREE.MeshBasicMaterial({ color: 0x00bfff, transparent: true, opacity: 0.65 });
      const rotors = [];
      for (let i = 0; i < 4; i += 1) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.01, 0.04), rotorMat);
        const ang = (i / 4) * Math.PI * 2;
        r.position.set(Math.cos(ang) * 0.22, 0.06, Math.sin(ang) * 0.22);
        grp.add(r);
        rotors.push(r);
      }
      const navLight = new THREE.PointLight(0x00bfff, 1.6, 6);
      navLight.position.y = 0.12;
      grp.add(navLight);
      grp.userData = { rotors, navLight };
    } else {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.35, 0.7),
        new THREE.MeshStandardMaterial({
          color: 0x39ff14,
          emissive: 0x39ff14,
          emissiveIntensity: 0.3,
          metalness: 0.5,
          roughness: 0.5
        })
      );
      body.position.y = 0.175;
      grp.add(body);
      const treadMat = new THREE.MeshStandardMaterial({ color: 0x1a3a1a, roughness: 0.9 });
      const treadL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.78), treadMat);
      treadL.position.set(-0.34, 0.08, 0);
      grp.add(treadL);
      const treadR = treadL.clone();
      treadR.position.x = 0.34;
      grp.add(treadR);
      const navLight = new THREE.PointLight(0x39ff14, 1.2, 5);
      navLight.position.y = 0.5;
      grp.add(navLight);
      grp.userData = { navLight };
    }
    grp.position.set(a.location[0] + 0.5, a.type === "drone" ? 2.0 : 0, a.location[1] + 0.5);
    pov.scene.add(grp);
    pov.agentMeshes.set(a.id, grp);
  }

  // Handle resize
  const ro = new ResizeObserver(() => resize3D());
  resizeObserver = ro;
  if (povCanvas.parentElement) ro.observe(povCanvas.parentElement);
  resize3D();

  pov.initialized = true;
}

function resize3D() {
  if (!pov.renderer || !povCanvas.parentElement) return;
  const w = povCanvas.parentElement.clientWidth;
  const h = povCanvas.parentElement.clientHeight;
  if (w === 0 || h === 0) return;
  pov.renderer.setSize(w, h, false);
  pov.camera.aspect = w / h;
  pov.camera.updateProjectionMatrix();
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
  if (!pov.initialized || !state) return;
  const frac = Math.min(1, Math.max(0, (performance.now() - lastTickAt) / MS_PER_TICK));

  // Update agent positions (interpolated) + rotor spin
  for (const a of state.agents) {
    const mesh = pov.agentMeshes.get(a.id);
    if (!mesh) continue;
    const prev = a.prevLocation || a.location;
    const ix = lerp(prev[0], a.location[0], frac);
    const iy = lerp(prev[1], a.location[1], frac);
    const targetY = a.type === "drone" ? 2.0 + Math.sin(t * 1.6 + a.id.charCodeAt(0)) * 0.08 : 0;
    mesh.position.set(ix + 0.5, targetY, iy + 0.5);

    // Face direction of motion
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
  }

  // Update victim appearance by status (color + bobbing + intensity)
  for (const v of state.victims) {
    const m = pov.victimMeshes.get(v.id);
    if (!m) continue;
    const isAlive = v.status === "trapped" || v.status === "unknown";
    const color = v.status === "rescued" ? 0x39ff14 : v.status === "dead" ? 0x444444 : 0xff6666;
    m.post.material.color.setHex(color);
    m.post.material.emissive.setHex(color);
    m.arm.material.color.setHex(color);
    m.arm.material.emissive.setHex(color);
    m.flare.color.setHex(color);
    m.flare.intensity = isAlive ? 0.5 + 0.5 * (Math.sin(t * 4 + v.id.charCodeAt(1) * 0.3) * 0.5 + 0.5) : 0.15;
    m.group.position.y = isAlive ? Math.abs(Math.sin(t * 2)) * 0.05 : 0;
  }

  // Risk-zone pulse
  for (const [, rz] of pov.riskMeshes) {
    const pulse = 0.35 + 0.18 * Math.sin(t * 1.4);
    rz.disk.material.opacity = pulse;
    rz.halo.intensity = 0.4 + 0.4 * Math.sin(t * 1.4);
  }

  // Blockade clear visual — fade out when cleared, restore on reset
  for (const blk of state.map.blocked_cells) {
    const mesh = pov.blockadeMeshes.get(blk.id);
    if (!mesh) continue;
    const cleared = blk.status === "cleared";
    if (cleared) {
      mesh.material.transparent = true;
      mesh.material.opacity = Math.max(0.05, mesh.material.opacity - 0.02);
      mesh.material.color.setHex(0x39ff14);
      mesh.scale.y = Math.max(0.05, mesh.scale.y - 0.01);
      mesh.position.y = 0.6 * mesh.scale.y;
    } else {
      mesh.material.transparent = false;
      mesh.material.opacity = 1;
      mesh.material.color.setHex(0x8b4513);
      const progress = blk.clear_progress / blk.repair_cost;
      mesh.scale.y = Math.max(0.2, 1 - progress * 0.6);
      mesh.position.y = 0.6 * mesh.scale.y;
    }
  }

  // FPV camera from selected drone
  const driver = state.agents.find((a) => a.id === selectedDroneId) || state.agents[0];
  if (driver) {
    const prev = driver.prevLocation || driver.location;
    const ix = lerp(prev[0], driver.location[0], frac);
    const iy = lerp(prev[1], driver.location[1], frac);

    const altitude = driver.type === "drone" ? 2.0 : 0.7;
    const headBobX = driver.type === "drone" ? Math.sin(t * 1.6) * 0.04 : 0;
    const headBobY = driver.type === "drone" ? Math.sin(t * 2.2) * 0.03 : 0;
    const targetPos = new THREE.Vector3(ix + 0.5 + headBobX, altitude + headBobY, iy + 0.5);

    // Look forward: prefer mission target, fallback to direction of motion
    const target = currentTargetFor(driver);
    const fwd = new THREE.Vector3();
    if (target) {
      fwd.set(target[0] + 0.5 - (ix + 0.5), -0.15, target[1] + 0.5 - (iy + 0.5));
    } else {
      const dx = driver.location[0] - prev[0];
      const dy = driver.location[1] - prev[1];
      if (Math.abs(dx) + Math.abs(dy) < 0.001) {
        fwd.set(Math.cos(t * 0.3), -0.15, Math.sin(t * 0.3));
      } else {
        fwd.set(dx, -0.15, dy);
      }
    }
    fwd.normalize();
    const lookAt = targetPos.clone().add(fwd.multiplyScalar(3));

    pov.smoothPos.lerp(targetPos, 0.18);
    pov.smoothLook.lerp(lookAt, 0.12);

    pov.camera.position.copy(pov.smoothPos);
    pov.camera.lookAt(pov.smoothLook);

    // Hide our own drone (so FPV doesn't show rotors blocking the view)
    const selfMesh = pov.agentMeshes.get(driver.id);
    if (selfMesh) selfMesh.visible = false;
    for (const [id, m] of pov.agentMeshes) {
      if (id !== driver.id) m.visible = true;
    }

    // HUD telemetry
    const vel = Math.hypot(driver.location[0] - prev[0], driver.location[1] - prev[1]) / (MS_PER_TICK / 1000);
    pov.smoothVel = lerp(pov.smoothVel, vel, 0.15);
    const hdgRad = Math.atan2(driver.location[0] - prev[0], driver.location[1] - prev[1]);
    const hdgDeg = ((hdgRad * 180) / Math.PI + 360) % 360;
    pov.smoothHdg = lerpAngleDeg(pov.smoothHdg, hdgDeg, 0.12);

    if (hudAlt) hudAlt.textContent = altitude.toFixed(1);
    if (hudHdg) hudHdg.textContent = String(Math.round(pov.smoothHdg)).padStart(3, "0");
    if (hudVel) hudVel.textContent = pov.smoothVel.toFixed(1);
    if (hudPwr) hudPwr.textContent = `${Math.round(driver.battery)}%`;
    if (hudTarget) {
      const targetId = currentTargetIdFor(driver);
      hudTarget.textContent = targetId ? `TGT ${targetId}` : "TGT —";
    }
  }

  if (pov.renderer && pov.scene && pov.camera) {
    pov.renderer.render(pov.scene, pov.camera);
  }
}

function lerpAngleDeg(a, b, t) {
  const diff = ((b - a + 540) % 360) - 180;
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

function populateDroneSwitcher(scenario) {
  if (!droneSwitcher) return;
  droneSwitcher.innerHTML = "";
  for (const a of scenario.agents) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = a.id;
    btn.dataset.agentId = a.id;
    if (a.id === selectedDroneId) btn.classList.add("active");
    btn.addEventListener("click", () => {
      selectedDroneId = a.id;
      droneSwitcher.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.agentId === a.id));
      const heading = document.querySelector("#povHeading");
      if (heading) heading.textContent = `FPV · ${a.id}`;
    });
    droneSwitcher.appendChild(btn);
  }
}

  const onStep = () => step();
  const onReset = () => reset();
  const onAutoToggle = () => {
    if (timer) {
      stopAuto();
      return;
    }
    autoBtn.textContent = "Pause";
    timer = setInterval(step, 900);
  };

  stepBtn.addEventListener("click", onStep);
  resetBtn.addEventListener("click", onReset);
  autoBtn.addEventListener("click", onAutoToggle);

  return () => {
    stepBtn.removeEventListener("click", onStep);
    resetBtn.removeEventListener("click", onReset);
    autoBtn.removeEventListener("click", onAutoToggle);
    stopAuto();
    if (typewriterTimer !== null) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (pov.renderer) {
      pov.renderer.dispose();
      pov.renderer = null;
    }
    pov.initialized = false;
  };
}
