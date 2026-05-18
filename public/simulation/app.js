import { TacticalRoadNetwork } from "./road-network.js";
import { synthesizeScenario, tagBuildingDamage } from "./js/scenario/synthesize.js";
import {
  currentScenePreset,
  readConfig,
  $,
  syncSimulationPresetClass,
  setCurrentScenePreset,
  setActivePreset,
} from "./js/config/presets.js";
import {
  tacticalBaseMapReady,
  tacticalRoadSegments,
  tacticalBuildingFootprints,
  registerTacticalGridDims,
  syncTacticalBasemapSize,
  applyTacticalBasemapStylePreset,
  syncTacticalBasemapDomVisibility,
  initTacticalBasemap,
  wireTacticalBasemapResize,
  scaleRoadSegmentsFromExport,
  rebuildTacticalRoadNetwork,
  rebuildTacticalBuildingFootprints,
} from "./js/geo/tactical-basemap.js";
import { drawMap2D } from "./js/render/map2d/index.js";
import { generatePlan } from "./js/sim/plan.js";
import { executeActions, moveAgentToward } from "./js/sim/actions.js";
import { updateVictims, updateBlockades } from "./js/sim/tick.js";
import { roundCoord } from "./js/sim/math.js";
import { simBridge } from "./js/sim/bridge.js";
import { MS_PER_TICK } from "./js/sim/timing.js";
import {
  init3D,
  update3D,
  teardown3D,
  buildingAvoidanceRects,
  bindWorld3dUi,
} from "./js/render/world3d/index.js";
import {
  applyFleetDialogueCotDom,
  liveAiModeEnabled,
  scheduleLiveAiRound,
  probeLmStudio,
  setAiStatusBadge,
  resetDecisionFeeds,
  bindAiDom,
  simulationTickIntervalMs,
  applyFetchedFleetDialogueCot,
} from "./js/ai/index.js";
import { emitToast } from "./js/ui/toast.js";
import {
  bindPanelsDom,
  renderPanels,
  recordSurvivalSample,
  popCounter,
  resetCotFeedState,
  survivalHistory,
  applyLiveFleetSlidesToDom,
  updateMissionLabels,
  primeCotFeedAutoThrottle,
} from "./js/ui/panels.js";
import { setupCommandCenter, getSpeedMultiplier } from "./js/ui/command-center.js";

const canvas = document.querySelector("#simCanvas");
const ctx = canvas.getContext("2d");
const tickLabel = document.querySelector("#tickLabel");
const rescuedCount = document.querySelector("#rescuedCount");
const priorityList = document.querySelector("#priorityList");
const agentList = document.querySelector("#agentList");
const briefText = document.querySelector("#briefText");
const thinkingFeedEl = document.querySelector("#thinkingText");
const cotCarouselTrack = document.querySelector("#cotCarouselTrack");
const cotCarouselViewport = document.querySelector("#cotCarouselViewport");
const cotSlideLabel = document.querySelector("#cotSlideLabel");
const stepBtn = document.querySelector("#stepBtn");
const autoBtn = document.querySelector("#autoBtn");
const resetBtn = document.querySelector("#resetBtn");
const survivalChart = document.querySelector("#survivalChart");
const chartCtx = survivalChart ? survivalChart.getContext("2d") : null;

const povCols = Array.from(document.querySelectorAll(".map-pov-col"));
const agentSelectorHost = document.querySelector("#agentSelector");
const povSubEl = document.querySelector("[data-pov-sub]");
const agentCardEls = new Map();

bindPanelsDom({
  tickLabel,
  rescuedCount,
  priorityList,
  agentList,
  survivalChart,
  chartCtx,
  cotCarouselTrack,
  cotCarouselViewport,
  cotSlideLabel,
});
bindWorld3dUi({
  agentSelectorHost,
  agentCardEls,
  povSubEl,
  DEFAULT_POV_AGENTS: ["Drone-1"],
});
bindAiDom({ thinkingFeedEl, briefText });

let initialScenario;
let state;
let timer = null;
let plan = null;
let rafId = null;
let lastTickAt = 0;
const T0 = performance.now();
const trails = new Map();
const TRAIL_LEN = 10;

let defaultScenario;

let roadExportBase = null;
let ugvRoadNetwork = null;
const roadRouteCache = new Map();

registerTacticalGridDims(() => (state?.map?.size ? state.map.size : [30, 30]));

function syncBridge() {
  simBridge.state = state;
  simBridge.plan = plan;
}

simBridge.hooks = {
  renderOnce: () => renderOnce(),
  getTimer: () => timer,
  startAuto: () => startAuto(),
  getSpeedMultiplier,
  applyLiveFleetSlidesToDom,
};

function tryUgvRoadNetworkFromLiveSegments() {
  if (!state?.map?.size || !tacticalRoadSegments.length) return;
  const [cols, rows] = state.map.size;
  const segs = tacticalRoadSegments.map((s) => ({
    a: { x: s.a.x, y: s.a.y },
    b: { x: s.b.x, y: s.b.y },
  }));
  ugvRoadNetwork = new TacticalRoadNetwork(segs, [cols, rows], 0.55);
}

function refreshUgvRoadNetwork() {
  if (!state?.map?.size) return;
  const [cols, rows] = state.map.size;
  ugvRoadNetwork = null;
  if (roadExportBase?.segments?.length) {
    const segs = scaleRoadSegmentsFromExport(roadExportBase, cols, rows);
    ugvRoadNetwork = new TacticalRoadNetwork(segs, [cols, rows], 0.55);
  }
  if (!ugvRoadNetwork?.available && tacticalRoadSegments.length) {
    tryUgvRoadNetworkFromLiveSegments();
  }
}

function getBlockedCellCentersForRoads() {
  if (!state?.map?.blocked_cells) return [];
  return state.map.blocked_cells
    .filter((b) => b.status === "blocked")
    .map((b) => b.location);
}

function agentUsesRoadRouting(agent) {
  if (!ugvRoadNetwork?.available) return false;
  const t = String(agent.type || "").toLowerCase();
  if (t === "drone" || t === "balloon") return false;
  return t === "ground_rescue" || t === "ground_clear" || t === "ground_armored" || t === "ugv";
}

function moveAgentOnRoad(agent, targetCell, targetKey) {
  if (!ugvRoadNetwork?.available) {
    moveAgentToward(agent, targetCell, state, buildingAvoidanceRects);
    return;
  }
  const speed = agent.speed || 1;
  const blockedPts = getBlockedCellCentersForRoads();
  const current = [agent.location[0], agent.location[1]];
  const target = [targetCell[0], targetCell[1]];
  const cached = roadRouteCache.get(agent.id);
  const [nextPt, routeState] = ugvRoadNetwork.routeStep(
    current,
    target,
    speed,
    targetKey,
    cached,
    blockedPts,
  );
  roadRouteCache.set(agent.id, routeState);
  agent.location = [roundCoord(nextPt[0]), roundCoord(nextPt[1])];
}

function applyBuildingsToState() {
  if (!state) return;
  if (!tacticalBuildingFootprints.length) {
    state.tacticalBuildings = [];
    return;
  }
  const cellSize = state.map?.cell_size_m || 10;
  const cloned = tacticalBuildingFootprints.map((b) => ({
    id: b.id,
    polygon: b.polygon,
    centroid: b.centroid,
    area: b.area,
    bounds: b.bounds,
    damage: "intact",
  }));
  tagBuildingDamage(cloned, state.map?.risk_zones || [], cellSize);
  state.tacticalBuildings = cloned;
}

function geoSynthesisContext() {
  return {
    buildingFootprints: tacticalBuildingFootprints,
    roadSegments: tacticalRoadSegments,
  };
}

function resolveScenarioFilename() {
  const params = new URLSearchParams(window.location.search);
  let raw = (params.get("scenario") || params.get("s") || "scenario_001.json").trim();
  if (/^\d+$/.test(raw)) {
    raw = `scenario_${String(parseInt(raw, 10)).padStart(3, "0")}.json`;
  } else if (raw && !raw.endsWith(".json")) {
    raw = `${raw}.json`;
  }
  if (!raw || /[\\/]/.test(raw) || raw.startsWith(".")) {
    raw = "scenario_001.json";
  }
  return raw;
}

applyFleetDialogueCotDom();

const RUN_LABEL_ATTR = "data-run-label";

function getRunLabel() {
  return autoBtn.querySelector(`[${RUN_LABEL_ATTR}]`);
}

function setRunLabel(text) {
  const lab = getRunLabel();
  if (lab) lab.textContent = text;
  else autoBtn.textContent = text;
}

function stopAuto() {
  clearInterval(timer);
  timer = null;
  setRunLabel("RUN");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function renderOnce() {
  syncBridge();
  renderPanels(plan);
  const basemapFor2d =
    tacticalBaseMapReady &&
    currentScenePreset !== "industrial" &&
    currentScenePreset !== "wildfire";
  drawMap2D({
    ctx,
    canvas,
    t: (performance.now() - T0) / 1000,
    state,
    trails,
    lastTickAt,
    tacticalBaseMapReady: basemapFor2d,
    scenePreset: currentScenePreset,
    msPerTick: MS_PER_TICK,
  });
}

function startAuto() {
  clearInterval(timer);
  primeCotFeedAutoThrottle();
  timer = setInterval(() => step(), simulationTickIntervalMs());
  setRunLabel("PAUSE");
}

function reset() {
  state = clone(initialScenario);
  state.timestep = 0;
  state.rescued = 0;
  lastTickAt = performance.now();

  roadRouteCache.clear();
  trails.clear();
  for (const agent of state.agents) {
    agent.prevLocation = [...agent.location];
    agent._rescueTarget = null;
    trails.set(agent.id, [{ x: agent.location[0], y: agent.location[1] }]);
  }

  refreshUgvRoadNetwork();
  if (tacticalBaseMapReady) {
    rebuildTacticalRoadNetwork(() => tryUgvRoadNetworkFromLiveSegments());
    rebuildTacticalBuildingFootprints(() => applyBuildingsToState());
  }
  applyBuildingsToState();

  survivalHistory.length = 0;
  recordSurvivalSample();
  plan = generatePlan(state);

  resetDecisionFeeds();
  resetCotFeedState();
  const log = document.getElementById("eventLog");
  if (log) log.innerHTML = "";

  stopAuto();
  renderOnce();
  startRafLoop();
  if (liveAiModeEnabled) scheduleLiveAiRound(plan);
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

  updateVictims(state);
  updateBlockades(state);
  plan = generatePlan(state);
  executeActions(state, plan.mission_plan, {
    moveAgentOnRoad,
    agentUsesRoadRouting,
    getBuildingRects: buildingAvoidanceRects,
  });
  for (const agent of state.agents) {
    if (!trails.has(agent.id)) trails.set(agent.id, []);
    const trail = trails.get(agent.id);
    trail.push({ x: agent.location[0], y: agent.location[1] });
    if (trail.length > TRAIL_LEN) trail.shift();
  }
  plan = generatePlan(state);

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
  if (liveAiModeEnabled) scheduleLiveAiRound(plan);
  return true;
}

function startRafLoop() {
  if (rafId !== null) return;
  const tick = (now) => {
    const t = (now - T0) / 1000;
    const basemapFor2d =
    tacticalBaseMapReady &&
    currentScenePreset !== "industrial" &&
    currentScenePreset !== "wildfire";
    drawMap2D({
      ctx,
      canvas,
      t,
      state,
      trails,
      lastTickAt,
      tacticalBaseMapReady: basemapFor2d,
      scenePreset: currentScenePreset,
      msPerTick: MS_PER_TICK,
    });
    syncBridge();
    update3D(t, { state, plan, lastTickAt, msPerTick: MS_PER_TICK });
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function rebuildSimulation(cfg) {
  stopAuto();

  if (state?.agents) {
    state.agents.forEach((a) => {
      a._rescueTarget = null;
    });
  }
  roadRouteCache.clear();

  teardown3D();
  const pk = cfg.preset || "urban_quake";
  setCurrentScenePreset(pk);
  initialScenario = synthesizeScenario(defaultScenario, cfg, geoSynthesisContext());
  init3D(initialScenario, pk, povCols);

  reset();
  updateMissionLabels(cfg);
  applyTacticalBasemapStylePreset(pk);
  syncSimulationPresetClass(pk);

  if (state && plan) renderOnce();
}

const scenarioFile = resolveScenarioFilename();
Promise.all([
  fetch(`/simulation/data/scenarios/${encodeURIComponent(scenarioFile)}`).then((response) => {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }),
  fetch("/simulation/data/geo/firenze_300m_roads.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
  fetch("/simulation/data/agents/fleet-dialogue-cot.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
])
  .then(([scenario, roadsData, fleetCot]) => {
    applyFetchedFleetDialogueCot(fleetCot);
    applyFleetDialogueCotDom();
    roadExportBase = roadsData;
    defaultScenario = scenario;
    setCurrentScenePreset(readConfig().preset);
    syncTacticalBasemapDomVisibility(currentScenePreset);
    initialScenario = synthesizeScenario(scenario, readConfig(), geoSynthesisContext());
    init3D(initialScenario, currentScenePreset, povCols);
    reset();
    setupCommandCenter({
      rebuildSimulation,
      refreshAutoTimer: () => {
        if (timer) startAuto();
      },
    });
    if (liveAiModeEnabled) void probeLmStudio();
    else setAiStatusBadge(false);
  })
  .catch((err) => {
    console.error(`[simulation] Bootstrap failed (${scenarioFile}):`, err);
    const id = document.getElementById("briefText");
    if (id) {
      const detail = err && err.message ? ` ${err.message}` : "";
      id.textContent =
        `Could not start mission (scenario “${scenarioFile}”, or a later init step, failed).${detail} Check the console.`;
    }
  });

stepBtn.addEventListener("click", () => {
  if (state) step();
});
resetBtn.addEventListener("click", () => {
  if (state) reset();
});
autoBtn.addEventListener("click", () => {
  if (timer) {
    stopAuto();
    return;
  }
  startAuto();
});

document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") {
    e.preventDefault();
    autoBtn.click();
  } else if (e.key === ".") {
    e.preventDefault();
    stepBtn.click();
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    resetBtn.click();
  }
});

initTacticalBasemap({
  onIdle() {
    rebuildTacticalRoadNetwork(() => tryUgvRoadNetworkFromLiveSegments());
    rebuildTacticalBuildingFootprints(() => applyBuildingsToState());
  },
});
wireTacticalBasemapResize();
requestAnimationFrame(() => syncTacticalBasemapSize());
