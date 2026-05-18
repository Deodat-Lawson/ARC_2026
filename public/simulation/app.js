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
import { occupancyGridRouteStep } from "./js/sim/path-planners.js";
import { updateVictims, updateBlockades } from "./js/sim/tick.js";
import { roundCoord } from "./js/sim/math.js";
import { pointNearBuilding } from "./js/sim/collision.js";
import { avoidBuildingStep } from "./js/sim/motion-avoid.js";
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
  probeGemmaBackend,
  setAiStatusBadge,
  resetDecisionFeeds,
  bindAiDom,
  simulationTickIntervalMs,
  applyFetchedFleetDialogueCot,
} from "./js/ai/index.js";
import { emitToast, logEvent, seedEventLog, syncEventLogPlaceholder } from "./js/ui/toast.js";
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
import { wireTacticalFpvFullscreen } from "./js/ui/tactical-fpv-fullscreen.js";

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

/** Match Fleet Status list scroll area to center “Fleet dialogue & CoT” (`.vp-mission`). */
function wireRailFleetHeightToCot() {
  const cot = document.querySelector(".vp-mission");
  const fleet = document.querySelector(".rail-fleet");
  const list = fleet?.querySelector(".agent-list");
  const events = document.querySelector(".rail-events");
  const railR = document.querySelector(".cc-rail-r");
  if (!cot || !fleet || !list) return;

  const apply = () => {
    if (!railR || getComputedStyle(railR).display === "none") {
      fleet.style.removeProperty("flex");
      list.style.removeProperty("max-height");
      return;
    }
    const cotH = Math.round(cot.getBoundingClientRect().height);
    if (cotH < 1) return;
    const head = fleet.querySelector(".rail-section-head");
    const headH = head ? Math.round(head.getBoundingClientRect().height) : 0;
    const pad = 28;
    const railH = Math.round(railR.getBoundingClientRect().height);
    const eventsH = events ? Math.round(events.getBoundingClientRect().height) : 220;
    const aiHead = railR.querySelector(".rail-ai-command .rail-section-head");
    const aiHeadH = aiHead ? Math.round(aiHead.getBoundingClientRect().height) : 48;
    const aiMin = 180;
    const listFromCot = cotH - headH - pad;
    const listFromRail = railH - eventsH - headH - pad - aiMin - aiHeadH;
    fleet.style.flex = "0 0 auto";
    list.style.maxHeight = `${Math.max(100, Math.min(listFromCot, listFromRail))}px`;
  };

  const ro = new ResizeObserver(() => requestAnimationFrame(apply));
  ro.observe(cot);
  window.addEventListener("resize", apply);
  requestAnimationFrame(apply);
}

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
const industrialGridRouteCache = new Map();
let industrialVictimsRelocatedForObstacleSig = "";

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

/** Ground units on industrial preset use occupancy-grid A* instead of the civic road graph. */
function agentUsesIndustrialGrid(agent) {
  if (currentScenePreset !== "industrial") return false;
  const t = String(agent.type || "").toLowerCase();
  if (t === "drone" || t === "balloon") return false;
  return t === "ground_rescue" || t === "ground_clear" || t === "ground_armored" || t === "ugv";
}

function moveAgentOnIndustrialGrid(agent, targetCell, targetKey) {
  const speed = agent.speed || 1;
  const current = [agent.location[0], agent.location[1]];
  const target = [targetCell[0], targetCell[1]];
  const cached = industrialGridRouteCache.get(agent.id);
  const [nextPt, routeState] = occupancyGridRouteStep(
    current,
    target,
    speed,
    targetKey,
    cached,
    state,
    buildingAvoidanceRects,
  );
  industrialGridRouteCache.set(agent.id, routeState);

  const farFromGoal = Math.hypot(target[0] - current[0], target[1] - current[1]) > 0.35;
  const barelyMoved = Math.hypot(nextPt[0] - current[0], nextPt[1] - current[1]) < 0.03;
  const noWp = !routeState.waypoints?.length;
  if (barelyMoved && farFromGoal && noWp) {
    if (!buildingAvoidanceRects(state).length) {
      moveAgentToward(agent, targetCell, state, buildingAvoidanceRects);
    }
    return;
  }

  agent.location = [roundCoord(nextPt[0]), roundCoord(nextPt[1])];
}

function industrialObstacleSignature(rects) {
  return rects
    .map((r) => `${roundCoord(r.x)}:${roundCoord(r.z)}:${roundCoord(r.w)}:${roundCoord(r.d)}`)
    .join("|");
}

function nearestIndustrialPassableCell(point, rects) {
  if (!state?.map?.size) return point;
  const [cols, rows] = state.map.size;
  const blockedCells = new Set(
    (state.map.blocked_cells || [])
      .filter((b) => b.status === "blocked")
      .map((b) => `${Math.round(b.location[0])},${Math.round(b.location[1])}`),
  );
  let best = null;
  let bestSq = Infinity;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (blockedCells.has(`${x},${y}`)) continue;
      if (pointNearBuilding(x, y, rects, 0.42)) continue;
      const dsq = (x - point[0]) ** 2 + (y - point[1]) ** 2;
      if (dsq < bestSq) {
        bestSq = dsq;
        best = [x, y];
      }
    }
  }
  return best || point;
}

function ensureIndustrialVictimsOnPassableCells() {
  if (currentScenePreset !== "industrial" || !state?.victims?.length) return;
  const rects = buildingAvoidanceRects(state);
  if (!rects.length) return;
  const sig = industrialObstacleSignature(rects);
  if (sig === industrialVictimsRelocatedForObstacleSig) return;

  let moved = false;
  for (const victim of state.victims) {
    if (victim.status === "rescued" || victim.status === "dead") continue;
    if (!pointNearBuilding(victim.location[0], victim.location[1], rects, 0.42)) continue;
    const free = nearestIndustrialPassableCell(victim.location, rects);
    if (free[0] === victim.location[0] && free[1] === victim.location[1]) continue;
    victim.location = free;
    moved = true;
  }
  if (moved) {
    industrialGridRouteCache.clear();
    plan = generatePlan(state);
  }
  industrialVictimsRelocatedForObstacleSig = sig;
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

  // Tactical-road segments (OSM exports) are independent of the 3D synthetic
  // road grid, so the procedural building infill can drop a 1×1 building right
  // on top of a road point. Without this guard the routed `nextPt` puts the car
  // visibly inside a building — same behavior under mock and live-Gemma since
  // path execution is mode-independent. Push back to the closest clear spot.
  const rects = buildingAvoidanceRects(state);
  if (rects.length && pointNearBuilding(nextPt[0], nextPt[1], rects, 0.42)) {
    const safe = avoidBuildingStep(current, nextPt, target, speed, state, buildingAvoidanceRects);
    agent.location = [roundCoord(safe[0]), roundCoord(safe[1])];
    return;
  }
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
  if (state) logEvent("default", "AUTO paused");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tacticalBasemapVisibleFor2d() {
  if (!tacticalBaseMapReady || currentScenePreset === "industrial" || currentScenePreset === "wildfire") return false;
  const el = document.getElementById("tacticalBasemap");
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 2 && rect.height > 2;
}

function renderOnce() {
  syncBridge();
  renderPanels(plan);
  const basemapFor2d = tacticalBasemapVisibleFor2d();
  const fallbackRoadSegments = roadExportBase && state?.map?.size
    ? scaleRoadSegmentsFromExport(roadExportBase, state.map.size[0], state.map.size[1])
    : [];
  drawMap2D({
    ctx,
    canvas,
    t: (performance.now() - T0) / 1000,
    state,
    trails,
    lastTickAt,
    tacticalBaseMapReady: basemapFor2d,
    fallbackRoadSegments,
    scenePreset: currentScenePreset,
    msPerTick: MS_PER_TICK,
  });
}

function startAuto() {
  clearInterval(timer);
  primeCotFeedAutoThrottle();
  timer = setInterval(() => step(), simulationTickIntervalMs());
  setRunLabel("PAUSE");
  if (state) logEvent("default", "AUTO · closed-loop simulation running");
}

function reset() {
  state = clone(initialScenario);
  state.timestep = 0;
  state.rescued = 0;
  lastTickAt = performance.now();

  roadRouteCache.clear();
  industrialGridRouteCache.clear();
  industrialVictimsRelocatedForObstacleSig = "";
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
  syncBridge();
  recordSurvivalSample();
  plan = generatePlan(state);

  resetDecisionFeeds();
  resetCotFeedState();

  const cfg = readConfig();
  const preset = cfg.preset || currentScenePreset || "urban_quake";
  seedEventLog([
    { type: "default", description: `Mission reset · ${preset}` },
    { type: "default", description: "Press AUTO or Space to begin timestep loop" },
  ]);

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
  ensureIndustrialVictimsOnPassableCells();
  plan = generatePlan(state);
  executeActions(state, plan.mission_plan, {
    moveAgentOnRoad,
    agentUsesRoadRouting,
    agentUsesIndustrialGrid,
    moveAgentOnIndustrialGrid,
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
    } else if (before === "unknown" && victim.status === "trapped") {
      logEvent("default", `${victim.id} located · trapped`);
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
    const basemapFor2d = tacticalBasemapVisibleFor2d();
    const fallbackRoadSegments = roadExportBase && state?.map?.size
      ? scaleRoadSegmentsFromExport(roadExportBase, state.map.size[0], state.map.size[1])
      : [];
    drawMap2D({
      ctx,
      canvas,
      t,
      state,
      trails,
      lastTickAt,
      tacticalBaseMapReady: basemapFor2d,
      fallbackRoadSegments,
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
  industrialGridRouteCache.clear();
  industrialVictimsRelocatedForObstacleSig = "";

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
    if (liveAiModeEnabled) void probeGemmaBackend();
    else setAiStatusBadge(false);
    syncEventLogPlaceholder();
  })
  .catch((err) => {
    console.error(`[simulation] Bootstrap failed (${scenarioFile}):`, err);
    const id = document.getElementById("briefText");
    if (id) {
      const detail = err && err.message ? ` ${err.message}` : "";
      id.textContent =
        `Could not start mission (scenario "${scenarioFile}", or a later init step, failed).${detail} Check the console.`;
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
  wildfire: {
    label: "MSN-002 · WILDFIRE-WUI",
    phase: "PERIMETER ASSESS · GEMMA-4",
    grid: 34, victims: 6, blockades: 1, fires: 3, collapses: 0,
    intensity: 85, severity: 60, scout: 2, relay: 1, rescue: 1, clear: 0,
    balloons: 2, armored: 2,
    baseRange: 14, relayRange: 9, deadRadius: 3, dropout: 25
  },
  industrial: {
    label: "MSN-003 · INDUSTRIAL-COLLAPSE",
    phase: "STRUCTURAL TRIAGE · GEMMA-4",
    grid: 28, victims: 4, blockades: 4, fires: 1, collapses: 2,
    intensity: 80, severity: 70, scout: 1, relay: 1, rescue: 1, clear: 2,
    balloons: 1, armored: 2,
    baseRange: 10, relayRange: 7, deadRadius: 5, dropout: 30
  }
});

wireTacticalBasemapResize();
wireTacticalFpvFullscreen();
wireRailFleetHeightToCot();
requestAnimationFrame(() => syncTacticalBasemapSize());
