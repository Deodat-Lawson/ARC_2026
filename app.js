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

let initialScenario;
let state;
let timer = null;
let plan = null;

fetch("scenario_001.json")
  .then((response) => response.json())
  .then((scenario) => {
    initialScenario = scenario;
    reset();
  });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reset() {
  state = clone(initialScenario);
  state.timestep = 0;
  state.rescued = 0;
  plan = generatePlan();
  stopAuto();
  render();
}

function step() {
  state.timestep += 1;
  updateVictims();
  updateBlockades();
  plan = generatePlan();
  executeActions(plan.mission_plan);
  plan = generatePlan();
  render();
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

function render() {
  drawMap();
  renderPanels();
}

function drawMap() {
  const [cols, rows] = state.map.size;
  const cell = canvas.width / cols;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid(cols, rows, cell);
  drawCommunication(cell);
  drawRiskZones(cell);
  drawBlockades(cell);
  drawVictims(cell);
  drawBase(cell);
  drawAgents(cell);
}

function drawGrid(cols, rows, cell) {
  ctx.fillStyle = "#151b1e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#263037";
  ctx.lineWidth = 1;
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
  ctx.fillStyle = "#59646b";
  for (let y = 2; y < rows; y += 5) ctx.fillRect(0, y * cell + cell * 0.28, canvas.width, cell * 0.44);
  for (let x = 2; x < cols; x += 6) ctx.fillRect(x * cell + cell * 0.28, 0, cell * 0.44, canvas.height);
}

function drawCommunication(cell) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.setLineDash([8, 8]);
  for (const zone of state.map.communication_dead_zones) {
    circle(zone.center, zone.radius * cell, cell, false);
  }
  ctx.restore();

  const relay = state.agents.find((agent) => agent.id === "Drone-2");
  if (relay && distance(relay.location, [14, 7]) <= 1.5) {
    ctx.fillStyle = "rgba(156, 111, 255, 0.14)";
    circle(relay.location, state.communication.relay_range * cell, cell, true);
  }
}

function drawRiskZones(cell) {
  for (const zone of state.map.risk_zones) {
    ctx.fillStyle = zone.type === "fire" ? "rgba(238,96,85,0.32)" : "rgba(168,135,255,0.28)";
    circle(zone.center, zone.radius * cell, cell, true);
  }
}

function drawBlockades(cell) {
  for (const blockade of state.map.blocked_cells) {
    if (blockade.status === "cleared") continue;
    const [x, y] = blockade.location;
    ctx.fillStyle = "#050505";
    ctx.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
    ctx.fillStyle = "#f2c14e";
    ctx.fillRect(x * cell + 5, y * cell + cell - 8, (cell - 10) * (blockade.clear_progress / blockade.repair_cost), 3);
  }
}

function drawVictims(cell) {
  for (const victim of state.victims) {
    const [x, y] = victim.location;
    ctx.fillStyle = victim.status === "rescued" ? "#4ecb71" : victim.status === "dead" ? "#68747a" : "#f2c14e";
    circle([x + 0.5, y + 0.5], cell * 0.34, cell, true);
    drawLabel(victim.id, x, y, cell);
  }
}

function drawBase(cell) {
  const [x, y] = state.map.base;
  ctx.fillStyle = "#edf4f2";
  ctx.fillRect(x * cell + 4, y * cell + 4, cell - 8, cell - 8);
  ctx.fillStyle = "#101315";
  ctx.font = "700 11px sans-serif";
  ctx.fillText("B", x * cell + cell * 0.34, y * cell + cell * 0.64);
}

function drawAgents(cell) {
  for (const agent of state.agents) {
    const [x, y] = agent.location;
    ctx.fillStyle = agent.type === "drone" ? "#4ea5ff" : "#4ecb71";
    ctx.beginPath();
    if (agent.type === "drone") {
      ctx.moveTo((x + 0.5) * cell, y * cell + 5);
      ctx.lineTo((x + 0.84) * cell, (y + 0.78) * cell);
      ctx.lineTo((x + 0.16) * cell, (y + 0.78) * cell);
    } else {
      ctx.rect(x * cell + 5, y * cell + 5, cell - 10, cell - 10);
    }
    ctx.fill();
    drawLabel(agent.id.replace("-", ""), Math.floor(x), Math.floor(y), cell);
  }
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

function renderPanels() {
  tickLabel.textContent = `Timestep ${state.timestep}`;
  rescuedCount.textContent = state.rescued;

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

  briefText.textContent = plan.commander_briefing;
  missionJson.textContent = JSON.stringify(plan, null, 2);
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
