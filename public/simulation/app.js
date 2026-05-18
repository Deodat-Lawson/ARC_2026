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

/** Match right-rail “Fleet Status” block height to center “Fleet dialogue & CoT” (`.vp-mission`). */
function wireRailFleetHeightToCot() {
  const cot = document.querySelector(".vp-mission");
  const fleet = document.querySelector(".rail-fleet");
  const railR = document.querySelector(".cc-rail-r");
  if (!cot || !fleet) return;

  const apply = () => {
    if (!railR || getComputedStyle(railR).display === "none") {
      fleet.style.removeProperty("height");
      fleet.style.removeProperty("flex");
      return;
    }
    const h = Math.round(cot.getBoundingClientRect().height);
    if (h < 1) return;
    fleet.style.flex = "0 0 auto";
    fleet.style.height = `${h + 100}px`;
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
const MS_PER_TICK = 900;
/** Slower auto-step interval in GEMMA4 mode so LiteRT rounds can finish before the next tick (no MOCK backfill). */
const GEMMA_MS_PER_TICK = 12000;
/** Min wall time between new Fleet dialogue cards while auto-run is on (~4.4s). Multi-agent CoT in the field is usually seconds–tens of seconds per published heartbeat; this keeps the feed readable without slowing the simulation grid. Manual step still updates every tick. */
const COT_FEED_AUTO_MIN_MS = 4400;
/** Victim HP/damage — aligned with demo_player (timeline.json) scale.
 *  hp_max: 5 000–10 000 per victim; damage_per_step: 40–100 per tick.
 *  survival_pct = hp / hp_max × 100 (individual, not cross-victim). */
const VICTIM_HP_MIN   = 5000;
const VICTIM_HP_RANGE = 5000;   // hp_max ∈ [HP_MIN, HP_MIN + HP_RANGE)
const VICTIM_DMG_MIN  = 40;
const VICTIM_DMG_RANGE = 61;    // damage ∈ [DMG_MIN, DMG_MIN + DMG_RANGE)
const MAX_EVENT_LOG = 20;
/** Legacy fallback if `fleet-dialogue-cot.json` fails to load */
const COT_FEED_MAX_BLOCKS = 28;

const FLEET_DIALOGUE_COT_BUILTIN = {
  version: 1,
  feedMaxBlocks: 28,
  feedSlideMax: 6,
  ui: {
    panel: {
      kicker: "Gemma 4 · Mesh agents",
      title: "Fleet dialogue & CoT",
      toolsAriaLabel: "Transcript",
      jumpTitle: "Jump to latest heartbeat (top)",
      jumpAriaLabel: "Jump to latest",
      copyTitle: "Copy full transcript",
      copyAriaLabel: "Copy transcript",
      metaSep: "·",
      slideLabelDefault: "—",
      autoHint: "scroll for history · latest at top",
    },
    feed: {
      chainOfThoughtLabel: "Chain-of-thought",
      blockHeadTemplate: "${padT} · Gemma 4 fleet heartbeat",
      liveBadge: "● LIVE",
      radioArrow: "▶",
    },
    transcript: {
      sectionHeaderTemplate: "# ${padT} · fleet dialogue",
      chunkSeparator: "\n\n---\n\n",
      cotBulletPrefix: "  • ",
      cotBracketTemplate: "[CoT · ${who}]",
      msgLineTemplate: "[${who} → ${to}] ${text}",
    },
    meta: {
      latestTemplate: "Latest ${padT} · ${head}",
    },
  },
  dialogue: {
    standby: {
      title: "Standby",
      who: "Gemma 4 · edge",
      lines: ["Waiting for simulation state."],
    },
    orchestrator: {
      slideTitleTemplate: "${padT} · Gemma 4 orchestrator · CoT",
      who: "Gemma 4 · mesh orchestrator",
      heartbeatFused: "${padT}: fused local grid + hazard layers ingested for this heartbeat.",
      rankingPrefix: "Surface ranking: ",
      rankingSuffix: ".",
      rankingItemTemplate: "${id}(${score})",
      noHypotheses: "No open hypotheses — patrol and logistics preservation mode.",
      leadVictim: "Lead ${id}: survival ${survivalPct}% (${survivalSteps}t), comm ${comm}, suggested mover ${bestAgent}.",
      policy: "Policy: emit ${taskCount} bound tasks after Gemma-4 safety gates.",
    },
    agentSlide: {
      slideTitleTemplate: "${padT} · ${agent} · ${taskHuman}",
      whoTemplate: "Gemma 4@${agent}",
      goal: "Goal: ${taskHuman} → ${target}.",
      nodeUav: "Node ${agent} (UAV): battery ${battery}, cell (${loc}).",
      nodeUgv: "Node ${agent} (UGV): battery ${battery}, cell (${loc}).",
      riskNote: "Risk note: ${note}",
      meshAck: "Require mesh ACK from ${peer} before committing motion.",
      peerFallback: "subscribers",
      radioToAllCall: "all-call",
      radioDroneOut: "${agent} → ${radioTo}: eyes on ${target}; holding safe offset orbit. Request ground corridor status before ingress.",
      radioUgvOut: "${agent} → ${radioTo}: advancing on routed cells toward ${target}; need air picture refresh each leg.",
      radioInRelay: "${peerId} → ${agent}: acknowledged — extending relay bubble; watch handoff latency.",
      radioInOther: "${peerId} → ${agent}: acknowledged — syncing posture; will shadow your vector.",
      meshAwait: "${padT} · mesh: await ARQ from ${agent}; no immediate peer on this hop.",
    },
    trafficNote: {
      slideTitleTemplate: "${padT} · Traffic note",
      who: "Gemma 4 · traffic agent",
      lineBlock: "${blockId} still blocks ground flow — convoy risk elevated until clearance is allocated.",
      lineRecommend: "Recommend re-running allocator when aerial confidence on the lane improves.",
    },
    meshStandby: {
      slideTitleTemplate: "${padT} · mesh standby",
      who: "mesh",
      to: "fleet",
      text: "No new task edges this heartbeat — autonomous patrol, battery-balanced loiter, and watch dormant thermal tiles.",
    },
  },
};

/** Resolved from JSON fetch when available; defaults to builtin (mirrors `fleet-dialogue-cot.json`). */
let fleetDialogueCot = FLEET_DIALOGUE_COT_BUILTIN;

function interpolate(template, vars = {}) {
  if (template == null) return "";
  return String(template).replace(/\$\{(\w+)\}/g, (_, key) =>
    (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ""));
}

function cotFeedMaxBlocks() {
  return fleetDialogueCot?.feedMaxBlocks ?? COT_FEED_MAX_BLOCKS;
}

function cotFeedSlideMax() {
  return fleetDialogueCot?.feedSlideMax ?? 6;
}

/** Apply panel chrome from `fleet-dialogue-cot.json` (kicker, title, buttons, meta). */
function applyFleetDialogueCotDom() {
  const ui = fleetDialogueCot?.ui;
  if (!ui) return;
  const p = ui.panel;
  if (p) {
    const k = document.getElementById("cotPanelKicker");
    const t = document.getElementById("cotPanelTitle");
    if (k) k.textContent = p.kicker ?? "";
    if (t) t.textContent = p.title ?? "";
    const tools = document.querySelector(".vp-mission-head .cot-carousel-tools");
    if (tools && p.toolsAriaLabel) tools.setAttribute("aria-label", p.toolsAriaLabel);
    const jump = document.getElementById("cotJumpLatest");
    if (jump) {
      if (p.jumpTitle) jump.title = p.jumpTitle;
      if (p.jumpAriaLabel) jump.setAttribute("aria-label", p.jumpAriaLabel);
    }
    const copyBtn = document.getElementById("copyJson");
    if (copyBtn) {
      if (p.copyTitle) copyBtn.title = p.copyTitle;
      if (p.copyAriaLabel) copyBtn.setAttribute("aria-label", p.copyAriaLabel);
    }
    const hint = document.getElementById("cotAutoHint");
    if (hint && p.autoHint) hint.textContent = p.autoHint;
    const sep = document.getElementById("cotMetaSep");
    if (sep && p.metaSep != null) sep.textContent = p.metaSep;
    const slideDef = document.getElementById("cotSlideLabel");
    if (slideDef && p.slideLabelDefault) slideDef.textContent = p.slideLabelDefault;
  }
}

/** Icons align with demo_player TOAST_CFG */
const TOAST_CFG = {
  rescued:          { icon: "✅", color: "#5dffb4", bg: "rgba(14,60,30,0.92)" },
  victim_dead:      { icon: "💔", color: "#ff5d6c", bg: "rgba(60,10,20,0.92)" },
  blockade_cleared: { icon: "🚧", color: "#ffd95d", bg: "rgba(60,50,0,0.9)" },
  relay_deployed:   { icon: "📡", color: "#c8b4ff", bg: "rgba(40,20,80,0.9)" },
  default:          { icon: "ℹ️", color: "#82c8ff", bg: "rgba(14,16,20,0.92)" },
};

let thinkingTimer = null;
let thinkingQueue = [];
let thinkingTyping = false;
const thinkingSeen = new Set();
const briefingSeen = new Set();

let cotFeedPrependedStep = -999;
/** Wall clock for throttling dialogue feed under auto-run (see {@link COT_FEED_AUTO_MIN_MS}). */
let lastCotFeedWallMs = 0;
const cotFeedTranscriptChunks = [];

/* ------------------------------------------------------------------------- */
/* Live Gemma 4 · LiteRT only (via /api/gemma-chat)                          */
/* ------------------------------------------------------------------------- */
const AI_ENDPOINT = "/api/gemma-chat";
const LIVE_AI_STORAGE_KEY = "arc_sim_ai_mode";

function readInitialLiveAiMode() {
  try {
    const q = (new URLSearchParams(window.location.search || "").get("ai") || "").toLowerCase();
    if (q === "mock" || q === "0" || q === "false") return false;
    if (q === "gemma" || q === "gemma4" || q === "1" || q === "true" || q === "live") return true;
  } catch { /* ignore */ }
  try {
    const s = localStorage.getItem(LIVE_AI_STORAGE_KEY);
    if (s === "mock") return false;
    if (s === "gemma") return true;
  } catch { /* ignore */ }
  return true;
}

/** When true, call backend for orchestrator / vision / fleet; when false, template-only MOCK. */
let liveAiModeEnabled = readInitialLiveAiMode();

function persistLiveAiMode() {
  try {
    localStorage.setItem(LIVE_AI_STORAGE_KEY, liveAiModeEnabled ? "gemma" : "mock");
  } catch { /* ignore */ }
}

function syncAiModeSegmentedUi() {
  const mockBtn = document.getElementById("aiModeMock");
  const gemmaBtn = document.getElementById("aiModeGemma");
  if (!mockBtn || !gemmaBtn) return;
  mockBtn.classList.toggle("active", !liveAiModeEnabled);
  gemmaBtn.classList.toggle("active", liveAiModeEnabled);
  mockBtn.setAttribute("aria-pressed", (!liveAiModeEnabled).toString());
  gemmaBtn.setAttribute("aria-pressed", liveAiModeEnabled.toString());
}

function applyLiveAiModeFromUser(enableGemma) {
  if (liveAiModeEnabled === enableGemma) return;
  liveAiModeEnabled = enableGemma;
  persistLiveAiMode();
  syncAiModeSegmentedUi();
  resetLiveAiState();
  if (!liveAiModeEnabled) {
    aiMetrics.mode = "MOCK";
    aiMetrics.backend = "template";
    aiMetrics.latencyMs = 0;
    aiMetrics.tokens = "n/a";
    setAiStatusBadge(false);
    syncMissionPhaseLabel();
    renderAiMetrics();
  } else {
    liveAiConnected = null;
    aiMetrics.mode = "LITERT";
    aiMetrics.backend = "litert";
    setAiStatusBadge(null);
    syncMissionPhaseLabel();
    renderAiMetrics();
    void probeLiteRT();
  }
  if (state && plan) {
    renderOnce();
    if (liveAiModeEnabled) scheduleLiveAiRound(plan);
  }
  if (timer) startAuto();
}

const agentHistories = {
  Drone_Alpha: [],
  Track_Beta: [],
  Relay_Gamma: [],
  Orchestrator: [],
};

const liveAiCache = {
  tick: -1,
  orchestratorTick: -1,
  orchestratorText: "",
  orchestratorLive: false,
  briefingTick: -1,
  briefingText: "",
  fleetSlides: null,
  droneMsg: "",
  betaMsg: "",
  gammaMsg: "",
};

let liveAiRequestId = 0;
let liveAiInFlight = false;
/** @type {boolean|null} null = probing, true = LiteRT reachable */
let liveAiConnected = null;

const aiMetrics = {
  mode: "MOCK",
  backend: "—",
  latencyMs: 0,
  tokens: "n/a",
  lastAgent: "—",
  round: 0,
};

function renderAiMetrics() {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("aiMetricMode", `MODE · ${aiMetrics.mode}`);
  set("aiMetricBackend", `BACKEND · ${aiMetrics.backend}`);
  set(
    "aiMetricLatency",
    liveAiModeEnabled && aiMetrics.mode === "MOCK"
      ? "LATENCY · 0 ms"
      : `LATENCY · ${aiMetrics.latencyMs > 0 ? `${aiMetrics.latencyMs} ms` : "—"}`
  );
  set("aiMetricTokens", `TOKENS · ${aiMetrics.tokens}`);
  set("aiMetricAgent", `AGENT · ${aiMetrics.lastAgent}`);
  set("aiMetricRound", `ROUND · ${aiMetrics.round}`);
  updateStatusFooter();
}

function updateStatusFooter() {
  const uplink = document.getElementById("statusUplink");
  const plan = document.getElementById("statusPlan");
  if (!uplink || !plan) return;
  if (!liveAiModeEnabled) {
    uplink.textContent = "— (simulated)";
    plan.textContent = "rule-based";
    return;
  }
  if (liveAiConnected !== true) {
    uplink.textContent = "pending";
    plan.textContent = "Gemma-4 · awaiting LiteRT";
    return;
  }
  uplink.textContent =
    aiMetrics.latencyMs > 0 ? `${aiMetrics.latencyMs} ms` : "—";
  const hz =
    aiMetrics.latencyMs > 0
      ? `${(1000 / aiMetrics.latencyMs).toFixed(2)}Hz`
      : "—";
  plan.textContent = `Gemma-4 · ${hz}`;
}

function syncMissionPhaseLabel() {
  const phaseEl = document.getElementById("msnPhase");
  if (!phaseEl) return;
  if (!liveAiModeEnabled) {
    phaseEl.textContent = "SIMULATION · RULE-BASED";
    return;
  }
  if (liveAiConnected === true) {
    phaseEl.textContent = "CLOSED LOOP · GEMMA-4 (LiteRT)";
    return;
  }
  phaseEl.textContent = "CLOSED LOOP · GEMMA-4 (connecting)";
}
/** Latest plan to run after the current Gemma round finishes (simulation keeps stepping). */
let liveAiPendingPlan = null;
let liveAiRoundStartedAt = 0;
const GEMMA_ROUND_TIMEOUT_MS = 180_000;

function simulationTickIntervalMs() {
  const base = liveAiModeEnabled ? GEMMA_MS_PER_TICK : MS_PER_TICK;
  return Math.max(80, base / speedMultiplier);
}

function releaseStuckLiveAiRound() {
  if (!liveAiInFlight) return false;
  if (performance.now() - liveAiRoundStartedAt < GEMMA_ROUND_TIMEOUT_MS) return false;
  liveAiRequestId += 1;
  liveAiInFlight = false;
  liveAiCache.orchestratorLive = false;
  emitToast("default", "Gemma 4 round timed out — simulation continues");
  return true;
}

/** GEMMA4: queue inference; never block simulation timestep (D — serial rounds, no MOCK). */
function scheduleLiveAiRound(plan) {
  if (!liveAiModeEnabled || !state || !plan) return;
  if (liveAiConnected === false) return;
  releaseStuckLiveAiRound();
  if (liveAiInFlight) {
    liveAiPendingPlan = plan;
    syncLiveAiHudPending();
    return;
  }
  void triggerLiveAiRound(plan);
}

function setAiStatusBadge(live) {
  const el = document.getElementById("gemmaAiStatus");
  if (!el) return;
  liveAiConnected = live;
  el.classList.toggle("live", live === true);
  el.classList.toggle("mock", live === false);
  el.classList.toggle("pending", live === null);
  const label = el.querySelector(".gemma-ai-status-label");
  if (!label) return;
  if (live === true) label.textContent = "● LIVE Gemma 4";
  else if (live === false) label.textContent = "○ MOCK mode";
  else label.textContent = "… Gemma 4";
  if (!liveAiModeEnabled) {
    aiMetrics.mode = "MOCK";
    aiMetrics.backend = "template";
  } else if (live === true) {
    aiMetrics.mode = "LITERT";
    aiMetrics.backend = "litert";
  } else if (live === false) {
    aiMetrics.mode = "LITERT";
    aiMetrics.backend = "offline";
  }
  syncMissionPhaseLabel();
  renderAiMetrics();
}

function capturePoV() {
  const povCanvas =
    povs[0]?.canvas ||
    povCols[0]?.querySelector("[data-pov-canvas]") ||
    document.querySelector("[data-pov-canvas]");
  if (!povCanvas || typeof povCanvas.toDataURL !== "function") return null;
  try {
    return povCanvas.toDataURL("image/jpeg", 0.5);
  } catch {
    return null;
  }
}

function buildSimulationContext(plan) {
  if (!state || !plan) return "Simulation standby.";
  const candidates = rankVictims();
  const trapped = state.victims.filter(
    (v) => v.status === "trapped" || v.status === "unknown"
  ).length;
  const total = state.victims.length || 1;
  const survivalRate = Math.round((trapped / total) * 100);
  const top = candidates[0];
  const tasks = (plan.mission_plan || [])
    .map((a) => `${a.agent}:${a.task}@${a.target}`)
    .join("; ");
  return [
    `T+${String(state.timestep).padStart(3, "0")}`,
    `rescued ${state.rescued}/${total}`,
    `open victims ${trapped}`,
    `survival pressure ~${survivalRate}%`,
    `priority ${(plan.priority_order || []).join(" → ") || "none"}`,
    top ? `lead ${top.id} score ${top.score.toFixed(2)} comm ${top.communication_status}` : "no lead victim",
    `tasks: ${tasks || "patrol / hold"}`,
  ].join(" | ");
}

function pushAgentHistory(agent, role, content) {
  if (!agentHistories[agent]) return;
  agentHistories[agent].push({ role, content });
  while (agentHistories[agent].length > 24) agentHistories[agent].shift();
}

async function callGemmaChat(agent, message, { history = [], image_base64, stream = false } = {}) {
  const t0 = performance.now();
  aiMetrics.lastAgent = agent;
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, message, history, image_base64, stream }),
  });
  const latencyHeader = res.headers.get("X-Arc-Latency-Ms");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    aiMetrics.latencyMs = Math.round(performance.now() - t0);
    aiMetrics.backend = err.meta?.backend || "litert";
    renderAiMetrics();
    return { fallback: true, content: "", error: err.error || res.statusText };
  }
  if (stream) {
    const latency_ms = latencyHeader
      ? Number(latencyHeader)
      : Math.round(performance.now() - t0);
    aiMetrics.latencyMs = latency_ms;
    aiMetrics.mode = "LITERT";
    aiMetrics.backend = "litert";
    aiMetrics.tokens = "n/a (stream)";
    renderAiMetrics();
    return { fallback: false, stream: res.body };
  }
  const data = await res.json();
  const meta = data.meta || {};
  aiMetrics.latencyMs = meta.latency_ms ?? Math.round(performance.now() - t0);
  aiMetrics.backend = meta.backend || "litert";
  aiMetrics.mode = meta.mode || "LITERT";
  aiMetrics.tokens =
    meta.tokens != null && meta.tokens !== "" ? String(meta.tokens) : "n/a (edge)";
  renderAiMetrics();
  return data;
}

async function streamGemmaToThinking(agent, message, history, requestId) {
  const el = thinkingFeedEl;
  if (!el) return "";

  liveAiCache.orchestratorLive = true;

  const row = document.createElement("div");
  row.className = "thinking-row thinking-row-live";
  const label = document.createElement("span");
  label.className = "thinking-step";
  label.textContent = `[T${String(state.timestep).padStart(3, "0")}] `;
  const body = document.createElement("span");
  body.className = "thinking-body";
  row.append(label, body);
  el.appendChild(row);
  syncLiveAiHudPending();

  const result = await callGemmaChat(agent, message, { history, stream: true });
  if (result.fallback || !result.stream) {
    row.remove();
    liveAiCache.orchestratorLive = false;
    syncLiveAiHudPending();
    return "";
  }

  const reader = result.stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    if (requestId !== liveAiRequestId) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content ?? json.content ?? "";
        if (token) {
          full += token;
          body.textContent = full;
          el.scrollTop = el.scrollHeight;
        }
      } catch {
        /* ignore partial SSE JSON */
      }
    }
  }

  const cancelled = requestId !== liveAiRequestId;
  const text = full.trim();
  liveAiCache.orchestratorLive = false;

  if (!text) {
    row.remove();
  } else {
    if (cancelled) body.textContent = `${text} …`;
    liveAiCache.orchestratorText = text;
    liveAiCache.orchestratorTick = state.timestep;
    pushAgentHistory("Orchestrator", "user", message);
    pushAgentHistory("Orchestrator", "assistant", text);
    thinkingSeen.add(text);
  }

  while (el.children.length > 80) el.removeChild(el.firstChild);
  syncLiveAiHudPending();
  return text;
}

function buildLiveFleetSlides(orchestrator, drone, beta, gamma, plan) {
  const padT = `T+${String(state.timestep).padStart(3, "0")}`;
  const slides = [];

  if (orchestrator) {
    slides.push({
      title: `${padT} · Gemma 4 orchestrator · CoT · LIVE`,
      turns: [
        {
          kind: "cot",
          who: "Gemma 4 · mesh orchestrator",
          lines: splitThinkingLog(orchestrator),
        },
      ],
    });
  }

  if (drone) {
    slides.push({
      title: `${padT} · Drone_Alpha · vision · LIVE`,
      turns: [
        {
          kind: "cot",
          who: "Gemma 4@Drone_Alpha",
          lines: [`FPV frame ingested. ${drone}`],
        },
        {
          kind: "msg",
          who: "Drone_Alpha",
          to: "fleet",
          cls: "drone",
          text: drone,
        },
      ],
    });
  }

  if (beta) {
    slides.push({
      title: `${padT} · Track_Beta · long-context · LIVE`,
      turns: [
        {
          kind: "cot",
          who: "Gemma 4@Track_Beta",
          lines: splitThinkingLog(beta),
        },
        {
          kind: "msg",
          who: "Track_Beta",
          to: "Relay_Gamma",
          cls: "ugv",
          text: beta,
        },
      ],
    });
  }

  if (gamma) {
    slides.push({
      title: `${padT} · Relay_Gamma · command · LIVE`,
      turns: [
        {
          kind: "cot",
          who: "Gemma 4@Relay_Gamma",
          lines: splitThinkingLog(gamma),
        },
        {
          kind: "msg",
          who: "Relay_Gamma",
          to: "fleet",
          cls: "drone",
          text: gamma,
        },
      ],
    });
  }

  if (!slides.length) return buildFleetDialogueSlides(plan);
  return slides;
}

function applyLiveFleetSlides(plan, slides) {
  liveAiCache.fleetSlides = slides;
  liveAiCache.tick = state.timestep;
  cotFeedPrependedStep = -999;
  updateFleetDialogueCarousel(plan, slides);
  updateCotFeedMeta(slides);
}

async function fetchOrchestrator(plan, contextMsg, requestId) {
  const history = agentHistories.Orchestrator.slice(-12);
  const prompt = `${contextMsg}\n\nThink step by step, then state orchestrator policy for this heartbeat.`;
  return streamGemmaToThinking("Orchestrator", prompt, history, requestId);
}

async function fetchDroneAlpha(plan, contextMsg, requestId) {
  const image = capturePoV();
  const prompt = image
    ? `${contextMsg}\n\nAnalyze the attached FPV frame: road damage, debris, and safest aerial corridor.`
    : `${contextMsg}\n\nNo FPV frame — infer from grid state and report visual assessment.`;
  const history = agentHistories.Drone_Alpha.slice(-12);
  const data = await callGemmaChat("Drone_Alpha", prompt, {
    history,
    image_base64: image || undefined,
    stream: false,
  });
  if (requestId !== liveAiRequestId || data.fallback) return "";
  const text = (data.content || "").trim();
  if (text) {
    pushAgentHistory("Drone_Alpha", "user", prompt);
    pushAgentHistory("Drone_Alpha", "assistant", text);
    liveAiCache.droneMsg = text;
    liveAiCache.briefingText = text;
    liveAiCache.briefingTick = state.timestep;
    if (plan) {
      plan.commander_briefing = text;
      syncBriefingFeed(plan);
      syncLiveAiHudPending();
    }
  }
  return text;
}

async function fetchTrackBeta(droneMsg, contextMsg, requestId) {
  const prompt = `Visual intel: "${droneMsg}". Context: ${contextMsg}. Assess surface stability and UGV passability.`;
  const history = agentHistories.Track_Beta.slice(-16);
  const data = await callGemmaChat("Track_Beta", prompt, { history, stream: false });
  if (requestId !== liveAiRequestId || data.fallback) return "";
  const text = (data.content || "").trim();
  if (text) {
    pushAgentHistory("Track_Beta", "user", prompt);
    pushAgentHistory("Track_Beta", "assistant", text);
    liveAiCache.betaMsg = text;
  }
  return text;
}

async function fetchRelayGamma(droneMsg, betaMsg, contextMsg, requestId) {
  const prompt = `Visual: "${droneMsg}". Ground: "${betaMsg}". Context: ${contextMsg}. Issue coordinated fleet movement orders.`;
  const history = agentHistories.Relay_Gamma.slice(-20);
  const data = await callGemmaChat("Relay_Gamma", prompt, { history, stream: false });
  if (requestId !== liveAiRequestId || data.fallback) return "";
  const text = (data.content || "").trim();
  if (text) {
    pushAgentHistory("Relay_Gamma", "user", prompt);
    pushAgentHistory("Relay_Gamma", "assistant", text);
    liveAiCache.gammaMsg = text;
  }
  return text;
}

async function probeLiteRT() {
  setAiStatusBadge(null);
  try {
    const res = await fetch(AI_ENDPOINT, { method: "GET", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data.ok === true;
    setAiStatusBadge(ok);
    if (ok && data.model) aiMetrics.backend = data.backend || "litert";
    renderAiMetrics();
    return ok;
  } catch {
    setAiStatusBadge(false);
    return false;
  }
}

/** @deprecated use probeLiteRT */
const probeLmStudio = probeLiteRT;

async function triggerLiveAiRound(plan) {
  if (!liveAiModeEnabled || !state || !plan) return;
  if (liveAiConnected === false) return;

  if (liveAiConnected === null) {
    const up = await probeLiteRT();
    if (!up) return;
  }

  aiMetrics.round += 1;
  renderAiMetrics();

  const requestId = ++liveAiRequestId;
  liveAiInFlight = true;
  liveAiRoundStartedAt = performance.now();
  syncLiveAiHudPending();
  const contextMsg = buildSimulationContext(plan);

  try {
    const orchestratorP = fetchOrchestrator(plan, contextMsg, requestId);
    const droneP = fetchDroneAlpha(plan, contextMsg, requestId);

    const [orchestrator, drone] = await Promise.all([orchestratorP, droneP]);
    if (requestId !== liveAiRequestId) return;

    const beta = await fetchTrackBeta(drone || "No visual report.", contextMsg, requestId);
    if (requestId !== liveAiRequestId) return;

    const gamma = await fetchRelayGamma(
      drone || "No visual report.",
      beta || "No ground assessment.",
      contextMsg,
      requestId
    );
    if (requestId !== liveAiRequestId) return;

    const slides = buildLiveFleetSlides(orchestrator, drone, beta, gamma, plan);
    applyLiveFleetSlides(plan, slides);
    setAiStatusBadge(true);
  } catch (err) {
    console.warn("[simulation] Live Gemma round failed:", err);
    setAiStatusBadge(false);
  } finally {
    if (requestId === liveAiRequestId) {
      liveAiInFlight = false;
      syncLiveAiHudPending();
      if (liveAiPendingPlan) {
        const pending = liveAiPendingPlan;
        liveAiPendingPlan = null;
        scheduleLiveAiRound(pending);
      }
    }
  }
}

function resetLiveAiState() {
  liveAiRequestId += 1;
  liveAiInFlight = false;
  liveAiPendingPlan = null;
  liveAiRoundStartedAt = 0;
  liveAiCache.tick = -1;
  liveAiCache.orchestratorTick = -1;
  liveAiCache.orchestratorText = "";
  liveAiCache.orchestratorLive = false;
  liveAiCache.briefingTick = -1;
  liveAiCache.briefingText = "";
  liveAiCache.fleetSlides = null;
  liveAiCache.droneMsg = "";
  liveAiCache.betaMsg = "";
  liveAiCache.gammaMsg = "";
  for (const key of Object.keys(agentHistories)) agentHistories[key].length = 0;
}

function splitThinkingLog(text) {
  return String(text || "")
    .split(/(?<=[。！？.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function appendThinkingEntry(el, step, text, animate = true) {
  if (!el) return;
  const row = document.createElement("div");
  row.className = "thinking-row";
  const label = document.createElement("span");
  label.className = "thinking-step";
  label.textContent = `[T${String(step).padStart(3, "0")}] `;
  const body = document.createElement("span");
  body.className = "thinking-body";
  row.append(label, body);
  el.appendChild(row);

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
    if (fleetCot && typeof fleetCot.version === "number") {
      fleetDialogueCot = fleetCot;
    } else {
      fleetDialogueCot = FLEET_DIALOGUE_COT_BUILTIN;
    }
    applyFleetDialogueCotDom();
    roadExportBase = roadsData;
    defaultScenario = scenario;
    initialScenario = synthesizeScenario(scenario, readConfig());
    init3D(initialScenario);
    reset();
    setupCommandCenter();
    if (liveAiModeEnabled) void probeLiteRT();
    else {
      setAiStatusBadge(false);
      renderAiMetrics();
    }
  })
  .catch((err) => {
    console.error(`[simulation] Failed to load /simulation/data/scenarios/${scenarioFile}:`, err);
    const id = document.getElementById("briefText");
    if (id) {
      id.textContent = `Could not load scenario file “${scenarioFile}”. Use ?scenario=scenario_002.json or check the console.`;
    }
  });

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
};

let activePreset = "urban_quake";

function $(id) { return document.getElementById(id); }

function readConfig() {
  const num = (id, fb) => {
    const el = $(id);
    if (!el) return fb;
    return Number(el.value);
  };
  const str = (id, fb) => {
    const el = $(id);
    return el ? el.value : fb;
  };
  return {
    preset: activePreset,
    missionId: str("cfgMissionId", "MSN-001"),
    grid: num("cfgGrid", 30),
    cellSize: num("cfgCell", 10),
    seed: num("cfgSeed", 42),
    scout: num("cfgScout", 1),
    relay: num("cfgRelay", 1),
    rescue: num("cfgRescue", 1),
    clearN: num("cfgClear", 1),
    balloons: num("cfgBalloons", 1),
    armored: num("cfgArmored", 0),
    battery: num("cfgBat", 75),
    victims: num("cfgVictim", 5),
    severity: num("cfgSeverity", 50) / 100,
    survivalWindow: num("cfgWindow", 200),
    blockades: num("cfgBlock", 2),
    fires: num("cfgFire", 1),
    collapses: num("cfgCollapse", 1),
    intensity: num("cfgIntensity", 70) / 100,
    baseRange: num("cfgBaseRange", 12),
    relayRange: num("cfgRelayRange", 8),
    deadRadius: num("cfgDead", 4),
    dropout: num("cfgDropout", 15) / 100
  };
}

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthesizeScenario(base, cfg) {
  // Build a brand-new scenario JSON from sliders, falling back to base values
  // for things the user hasn't explicitly controlled (sensor configs, etc.).
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

  // Risk zones
  const riskZones = [];
  for (let i = 0; i < cfg.fires; i += 1) {
    const c = pickCell(5);
    const radius = 2 + Math.floor(rng() * 2);
    riskZones.push({ id: `Z${riskZones.length + 1}`, center: c, radius, type: "fire", risk: 0.4 + cfg.intensity * 0.5 });
    mark(c[0], c[1], radius);
  }
  for (let i = 0; i < cfg.collapses; i += 1) {
    const c = pickCell(5);
    const radius = 2 + Math.floor(rng() * 2);
    riskZones.push({ id: `Z${riskZones.length + 1}`, center: c, radius, type: "collapse", risk: 0.35 + cfg.intensity * 0.45 });
    mark(c[0], c[1], radius);
  }

  // Comm dead zone — anchor on a risk zone if present, else a random cell
  const deadAnchor = riskZones.length ? riskZones[0].center : pickCell(6);
  const deadZones = cfg.deadRadius > 0 ? [{
    id: "C1",
    center: deadAnchor,
    radius: cfg.deadRadius,
    dropout_addition: Math.max(0.1, cfg.dropout * 2)
  }] : [];

  // Blockades
  const blockades = [];
  for (let i = 0; i < cfg.blockades; i += 1) {
    const loc = pickCell(3);
    blockades.push({
      id: `K${i + 1}`,
      location: loc,
      repair_cost: 60 + Math.floor(rng() * 30),
      clear_progress: 0,
      status: "blocked"
    });
    mark(loc[0], loc[1], 1);
  }

  // Victims — HP system aligned with demo_player (timeline.json):
  //   hp_max ∈ [5000, 10000), damage_per_step ∈ [40, 100)
  //   survival_pct = hp / hp_max × 100  (individual baseline, not cross-victim)
  const victims = [];
  for (let i = 0; i < cfg.victims; i += 1) {
    const loc = pickCell(4);
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
      thermal_signal: round(0.25 + rng() * 0.7),
      status: rng() < 0.85 ? "trapped" : "unknown"
    });
    mark(loc[0], loc[1], 1);
  }

  // Agents — spawn ring around base
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
      communication_dead_zones: deadZones
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

/* ── Tear down 3D world so Apply & Reset can rebuild ──────────────────── */
function disposeMaterial(mat) {
  if (!mat) return;
  for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) {
    if (mat[k]) try { mat[k].dispose(); } catch {}
  }
  try { mat.dispose(); } catch {}
}
function disposeObject(obj) {
  if (!obj) return;
  obj.traverse?.((node) => {
    if (node.isMesh) {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach(disposeMaterial);
      else disposeMaterial(node.material);
    }
  });
}

function teardown3D() {
  if (!world.initialized) return;
  // dispose every child of the scene
  if (world.scene) {
    const children = [...world.scene.children];
    for (const c of children) {
      disposeObject(c);
      world.scene.remove(c);
    }
  }
  // dispose per-pov renderers
  for (const entry of povs) {
    try { entry.renderer.dispose(); } catch {}
    const parent = entry.canvas.parentElement;
    if (parent) {
      // recreate canvas so we can attach a new renderer cleanly
      const fresh = entry.canvas.cloneNode(false);
      parent.replaceChild(fresh, entry.canvas);
    }
  }
  povs.length = 0;
  world.scene = null;
  world.agentMeshes.clear();
  world.victimMeshes.clear();
  world.blockadeMeshes.clear();
  world.riskMeshes.clear();
  world.baseMesh = null;
  world.groundGrid = null;
  world.initialized = false;
}

function rebuildSimulation(cfg) {
  stopAuto();

  // Wipe all runtime per-agent state so stale locks/routes from old fleet don't bleed in
  if (state?.agents) {
    state.agents.forEach((a) => { a._rescueTarget = null; });
  }
  roadRouteCache.clear();

  teardown3D();
  initialScenario = synthesizeScenario(defaultScenario, cfg);
  init3D(initialScenario);

  // reset() now: rebuilds road network → generates fresh plan → renders
  reset();
  updateMissionLabels(cfg);

  // Re-render panels immediately so CoT/Decision Hub reflect the new fleet plan
  if (state && plan) renderOnce();
}

/* ── KPI updates ───────────────────────────────────────────────────────── */
function updateCommandKpis(candidates) {
  const total = state?.victims?.length || 0;
  const alive = state?.victims?.filter((v) => v.status === "trapped" || v.status === "unknown" || v.status === "rescued").length || 0;
  const survivalRate = total ? Math.round((alive / total) * 100) : 0;
  const ofEl = $("rescuedOf"); if (ofEl) ofEl.textContent = total;
  const sEl = $("survivalPct");
  if (sEl) {
    sEl.textContent = `${survivalRate}%`;
    sEl.classList.remove("accent", "warn", "danger");
    sEl.classList.add(survivalRate > 75 ? "accent" : survivalRate > 45 ? "warn" : "danger");
  }
  const aEl = $("activeAgents");
  if (aEl) aEl.textContent = state?.agents?.length || 0;
  const tcEl = $("threatCount");
  if (tcEl) tcEl.textContent = candidates?.length || 0;
  const fcEl = $("fleetCount");
  if (fcEl) fcEl.textContent = state?.agents?.length || 0;
  // Bandwidth visual derived from active comm health
  const lvl = survivalRate > 80 ? 5 : survivalRate > 60 ? 4 : survivalRate > 40 ? 3 : survivalRate > 20 ? 2 : 1;
  const bw = $("bwBar");
  if (bw) bw.className = `bw lvl-${lvl}`;
}

function updateMissionLabels(cfg) {
  const preset = PRESET_DEFAULTS[cfg.preset] || PRESET_DEFAULTS.urban_quake;
  const idEl = $("msnId");
  if (idEl) idEl.textContent = `${cfg.missionId} · ${preset.label.split("· ")[1] || "MISSION"}`;
  syncMissionPhaseLabel();
  const gridBadge = $("gridBadge");
  if (gridBadge) gridBadge.textContent = `${cfg.grid} × ${cfg.grid}`;
}

/* ── Control wiring ────────────────────────────────────────────────────── */
function setupCommandCenter() {
  // Slider labels (live)
  const bind = (id, labelId, fmt) => {
    const input = $(id);
    const label = $(labelId);
    if (!input || !label) return;
    const render = () => { label.textContent = fmt(input.value); };
    input.addEventListener("input", render);
    render();
  };
  bind("cfgGrid", "cfgGridLabel", (v) => `${v} × ${v}`);
  bind("cfgCell", "cfgCellLabel", (v) => `${v}`);
  bind("cfgSeed", "cfgSeedLabel", (v) => `${v}`);
  bind("cfgScout", "cfgScoutLabel", (v) => `${v}`);
  bind("cfgRelay", "cfgRelayLabel", (v) => `${v}`);
  bind("cfgRescue", "cfgRescueLabel", (v) => `${v}`);
  bind("cfgClear", "cfgClearLabel", (v) => `${v}`);
  bind("cfgBalloons", "cfgBalloonsLabel", (v) => `${v}`);
  bind("cfgArmored", "cfgArmoredLabel", (v) => `${v}`);
  bind("cfgBat", "cfgBatLabel", (v) => `${v}%`);
  bind("cfgVictim", "cfgVictimLabel", (v) => `${v}`);
  bind("cfgSeverity", "cfgSeverityLabel", (v) => (v / 100).toFixed(2));
  bind("cfgWindow", "cfgWindowLabel", (v) => `${v}s`);
  bind("cfgBlock", "cfgBlockLabel", (v) => `${v}`);
  bind("cfgFire", "cfgFireLabel", (v) => `${v}`);
  bind("cfgCollapse", "cfgCollapseLabel", (v) => `${v}`);
  bind("cfgIntensity", "cfgIntensityLabel", (v) => (v / 100).toFixed(2));
  bind("cfgBaseRange", "cfgBaseRangeLabel", (v) => `${v}`);
  bind("cfgRelayRange", "cfgRelayRangeLabel", (v) => `${v}`);
  bind("cfgDead", "cfgDeadLabel", (v) => `${v}`);
  bind("cfgDropout", "cfgDropoutLabel", (v) => (v / 100).toFixed(2));

  // Presets
  document.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.preset;
      if (!PRESET_DEFAULTS[key]) return;
      activePreset = key;
      document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      const p = PRESET_DEFAULTS[key];
      const set = (id, v) => { const el = $(id); if (el) { el.value = v; el.dispatchEvent(new Event("input")); } };
      set("cfgGrid", p.grid);
      set("cfgVictim", p.victims);
      set("cfgBlock", p.blockades);
      set("cfgFire", p.fires);
      set("cfgCollapse", p.collapses);
      set("cfgIntensity", p.intensity);
      set("cfgSeverity", p.severity);
      set("cfgScout", p.scout);
      set("cfgRelay", p.relay);
      set("cfgRescue", p.rescue);
      set("cfgClear", p.clear);
      set("cfgBalloons", p.balloons);
      set("cfgArmored", p.armored);
      set("cfgBaseRange", p.baseRange);
      set("cfgRelayRange", p.relayRange);
      set("cfgDead", p.deadRadius);
      set("cfgDropout", p.dropout);
    });
  });

  // Apply & Reset
  const applyBtn = $("cfgApply");
  if (applyBtn) applyBtn.addEventListener("click", () => rebuildSimulation(readConfig()));

  // Quick randomize: re-roll seed only, keep counts
  const randBtn = $("cfgRandom");
  if (randBtn) randBtn.addEventListener("click", () => {
    const seed = $("cfgSeed");
    if (seed) {
      seed.value = 1 + Math.floor(Math.random() * 998);
      seed.dispatchEvent(new Event("input"));
    }
    rebuildSimulation(readConfig());
  });

  // Config rail toggle
  const cfgToggle = $("cfgToggle");
  const grid = $("ccGrid");
  if (cfgToggle && grid) {
    cfgToggle.addEventListener("click", () => grid.classList.toggle("cfg-collapsed"));
  }

  // Speed buttons
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".speed-btn").forEach((b) => b.classList.toggle("active", b === btn));
      speedMultiplier = Number(btn.dataset.speed) || 1;
      if (timer) startAuto();
    });
  });

  // Copy fleet dialogue transcript (Gemma 4 CoT + mesh)
  const copyBtn = $("copyJson");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(formatCotTranscript() || "");
      emitToast("default", "Fleet transcript copied");
    } catch {
      emitToast("default", "clipboard unavailable");
    }
  });

  const jumpCot = $("cotJumpLatest");
  if (jumpCot) jumpCot.addEventListener("click", () => scrollLatestCotIntoView(true));

  // Clear event log
  const clearBtn = $("clearLog");
  const logEl = $("eventLog");
  if (clearBtn && logEl) clearBtn.addEventListener("click", () => { logEl.innerHTML = ""; });

  // Mission ID input updates label live
  const idIn = $("cfgMissionId");
  if (idIn) idIn.addEventListener("input", () => updateMissionLabels(readConfig()));

  // Initial label paint
  updateMissionLabels(readConfig());

  // MOCK / GEMMA4 header toggle
  syncAiModeSegmentedUi();
  const aiModeMock = $("aiModeMock");
  const aiModeGemma = $("aiModeGemma");
  if (aiModeMock) aiModeMock.addEventListener("click", () => applyLiveAiModeFromUser(false));
  if (aiModeGemma) aiModeGemma.addEventListener("click", () => applyLiveAiModeFromUser(true));

  // Onboarding tour
  setupTour();

  // Bandwidth meter initial paint (will refresh on each render)
  const bw = $("bwBar");
  if (bw) bw.className = "bw lvl-5";
}

initTacticalBasemap();
wireTacticalBasemapResize();
wireRailFleetHeightToCot();
requestAnimationFrame(() => syncTacticalBasemapSize());
