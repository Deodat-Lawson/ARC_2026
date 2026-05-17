import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TacticalRoadNetwork } from "./road-network.js";

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
  horizonSilhouette: null,
  scenarioBuildingsGroup: null,
  roadsGroup: null,
  smokePuffs: [],
  fireGlows: [],
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
/* Live Gemma 4 · LM Studio / LiteRT (via /api/gemma-chat)                   */
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
    setAiStatusBadge(false);
  } else {
    liveAiConnected = null;
    setAiStatusBadge(null);
    void probeLmStudio();
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
/** @type {boolean|null} null = probing, true = LM Studio reachable */
let liveAiConnected = null;
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
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, message, history, image_base64, stream }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { fallback: true, content: "", error: err.error || res.statusText };
  }
  if (stream) return { fallback: false, stream: res.body };
  const data = await res.json();
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

async function probeLmStudio() {
  setAiStatusBadge(null);
  try {
    const res = await fetch(AI_ENDPOINT, { method: "GET", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data.ok === true;
    setAiStatusBadge(ok);
    return ok;
  } catch {
    setAiStatusBadge(false);
    return false;
  }
}

async function triggerLiveAiRound(plan) {
  if (!liveAiModeEnabled || !state || !plan) return;
  if (liveAiConnected === false) return;

  if (liveAiConnected === null) {
    const up = await probeLmStudio();
    if (!up) return;
  }

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

  const finish = () => {
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 80) el.removeChild(el.firstChild);
  };

  if (!animate) {
    body.textContent = text;
    finish();
    return;
  }

  let i = 0;
  thinkingTyping = true;
  clearInterval(thinkingTimer);
  thinkingTimer = setInterval(() => {
    body.textContent += text[i++] || "";
    el.scrollTop = el.scrollHeight;
    if (i >= text.length) {
      clearInterval(thinkingTimer);
      thinkingTimer = null;
      thinkingTyping = false;
      finish();
      playThinkingQueue(el);
    }
  }, 16);
}

function playThinkingQueue(el) {
  if (thinkingTyping || !thinkingQueue.length) return;
  const next = thinkingQueue.shift();
  appendThinkingEntry(el, next.step, next.text, next.animate);
}

function queueThinkingLog(el, step, text, animate = true) {
  splitThinkingLog(text).forEach((line) => {
    thinkingQueue.push({ step, text: line, animate });
  });
  playThinkingQueue(el);
}

function appendBriefingRow(el, step, text) {
  if (!el) return;
  const row = document.createElement("div");
  row.className = "briefing-row";
  const label = document.createElement("span");
  label.className = "briefing-step";
  label.textContent = `[T${String(step).padStart(3, "0")}] `;
  const body = document.createElement("span");
  body.className = "briefing-body";
  body.textContent = text;
  row.append(label, body);
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 48) el.removeChild(el.firstChild);
}

function buildThinkingNarrative(plan) {
  if (!plan || !state) return "Standing by — no planner output yet.";
  const parts = [];
  const po = plan.priority_order || [];
  if (po.length) {
    parts.push(`Victim stack is ${po.join(" → ")}. Re-checking comms, corridor risk, and battery headroom.`);
  }
  const verbs = {
    aerial_confirmation: "confirming",
    deploy_relay: "staging relay for",
    vibration_audio_verification: "closing on",
    ground_rescue: "extracting",
    clear_blockade: "clearing",
  };
  for (const a of plan.mission_plan || []) {
    const v = verbs[a.task] || "executing";
    parts.push(`${a.agent} is ${v} ${a.target}.`);
  }
  for (const line of plan.human_confirmation_required || []) {
    if (line && !/^no\s/i.test(line)) parts.push(`Commander gate: ${line}`);
  }
  if (!parts.length) parts.push("No open allocator edges — hold and refresh mesh telemetry.");
  return parts.join(" ");
}

function syncThinkingFeed(plan) {
  const el = thinkingFeedEl;
  if (!el || !plan) return;
  if (liveAiModeEnabled && liveAiConnected !== false) {
    if (liveAiCache.orchestratorLive || liveAiCache.orchestratorTick === state.timestep) return;
    if (liveAiConnected === null || liveAiInFlight) return;
  }
  const narrative = buildThinkingNarrative(plan);
  splitThinkingLog(narrative).forEach((line) => {
    if (thinkingSeen.has(line)) return;
    thinkingSeen.add(line);
    queueThinkingLog(el, state.timestep, line, true);
  });
}

function syncBriefingFeed(plan) {
  if (!briefText || !plan) return;
  if (liveAiModeEnabled && liveAiConnected !== false) {
    if (liveAiCache.briefingTick === state.timestep && liveAiCache.briefingText) {
      const text = liveAiCache.briefingText;
      if (briefingSeen.has(text)) return;
      briefingSeen.add(text);
      appendBriefingRow(briefText, state.timestep, text);
    }
    if (liveAiConnected === null || liveAiInFlight) return;
    return;
  }
  if (!plan.commander_briefing) return;
  const text = plan.commander_briefing;
  if (briefingSeen.has(text)) return;
  briefingSeen.add(text);
  appendBriefingRow(briefText, state.timestep, text);
}

/** UI-only placeholders while waiting for real Gemma output (not MOCK decision text). */
function syncLiveAiHudPending() {
  const briefId = "briefAiPending";
  const thinkId = "thinkAiPending";
  let bp = document.getElementById(briefId);
  let tp = document.getElementById(thinkId);

  const gemmaHud =
    liveAiModeEnabled && liveAiConnected !== false && state;

  const needBrief =
    gemmaHud &&
    (liveAiInFlight || liveAiConnected === null) &&
    liveAiCache.briefingTick !== state.timestep;

  const needThink =
    gemmaHud &&
    (liveAiInFlight || liveAiConnected === null) &&
    liveAiCache.orchestratorTick !== state.timestep &&
    !liveAiCache.orchestratorLive;

  if (needBrief && briefText) {
    if (!bp) {
      bp = document.createElement("div");
      bp.id = briefId;
      bp.className = "briefing-row briefing-row-pending";
      const label = document.createElement("span");
      label.className = "briefing-step";
      label.textContent = `[T${String(state.timestep).padStart(3, "0")}] `;
      const body = document.createElement("span");
      body.className = "briefing-body";
      body.textContent = "Awaiting Gemma 4 · Drone_Alpha vision…";
      bp.append(label, body);
      briefText.appendChild(bp);
    } else {
      bp.querySelector(".briefing-step").textContent =
        `[T${String(state.timestep).padStart(3, "0")}] `;
    }
  } else if (bp) {
    bp.remove();
  }

  if (needThink && thinkingFeedEl) {
    if (!tp) {
      tp = document.createElement("div");
      tp.id = thinkId;
      tp.className = "thinking-row thinking-row-pending";
      const label = document.createElement("span");
      label.className = "thinking-step";
      label.textContent = `[T${String(state.timestep).padStart(3, "0")}] `;
      const body = document.createElement("span");
      body.className = "thinking-body";
      body.textContent = "Awaiting Gemma 4 · orchestrator…";
      tp.append(label, body);
      thinkingFeedEl.appendChild(tp);
    } else {
      tp.querySelector(".thinking-step").textContent =
        `[T${String(state.timestep).padStart(3, "0")}] `;
    }
  } else if (tp) {
    tp.remove();
  }
}

function resetDecisionFeeds() {
  clearInterval(thinkingTimer);
  thinkingTimer = null;
  thinkingQueue.length = 0;
  thinkingTyping = false;
  thinkingSeen.clear();
  briefingSeen.clear();
  resetLiveAiState();
  if (thinkingFeedEl) thinkingFeedEl.innerHTML = "";
  if (briefText) briefText.innerHTML = "";
}
function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

/* ------------------------------------------------------------------------- */
/* Tactical basemap — MapLibre + PMTiles (Firenze), aligned with demo_player */
/* ------------------------------------------------------------------------- */
const TACTICAL_PMTILES_REMOTE = "https://pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles";
const GEO_BOUNDS_300M = {
  label: "Firenze Centro 300m x 300m",
  southWest: [43.76825, 11.25393],
  northEast: [43.77095, 11.25767],
};

function resolveTacticalPmtilesUrl() {
  try {
    const o = window.location?.origin;
    if (o && o !== "null" && window.location?.protocol !== "file:") {
      return `${o}/api/pmtiles-proxy`;
    }
  } catch {
    /* ignore */
  }
  return TACTICAL_PMTILES_REMOTE;
}

let tacticalPmtilesUrl = resolveTacticalPmtilesUrl();
let tacticalBaseMap = null;
let tacticalBaseMapReady = false;
let tacticalPmtilesProtoInstalled = false;
let tacticalPmtilesProtocol = null;
let tacticalRoadSegments = [];
let tacticalRoadNetworkReady = false;
let tacticalBuildingFootprints = [];
let tacticalBuildingsReady = false;

/** OSM road export (lite_sim firenze_300m_roads.json) + live PMTiles fallback */
let roadExportBase = null;
let ugvRoadNetwork = null;
const roadRouteCache = new Map();

function getTacticalGridDims() {
  if (state?.map?.size) return state.map.size;
  return [30, 30];
}

function tacticalLngLatToGrid(lng, lat) {
  const [cols, rows] = getTacticalGridDims();
  const west = GEO_BOUNDS_300M.southWest[1];
  const east = GEO_BOUNDS_300M.northEast[1];
  const north = GEO_BOUNDS_300M.northEast[0];
  const south = GEO_BOUNDS_300M.southWest[0];
  return {
    x: ((lng - west) / (east - west)) * cols,
    y: ((north - lat) / (north - south)) * rows,
  };
}

function syncTacticalBasemapSize() {
  const el = document.getElementById("tacticalBasemap");
  if (!el || !canvas) return;
  const w = Math.max(1, Math.floor(canvas.clientWidth));
  const h = Math.max(1, Math.floor(canvas.clientHeight));
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  if (tacticalBaseMap) {
    tacticalBaseMap.resize();
    tacticalBaseMap.fitBounds(
      [
        [GEO_BOUNDS_300M.southWest[1], GEO_BOUNDS_300M.southWest[0]],
        [GEO_BOUNDS_300M.northEast[1], GEO_BOUNDS_300M.northEast[0]],
      ],
      { padding: 0, duration: 0 },
    );
  }
}

function makeTacticalBasemapStyle() {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${tacticalPmtilesUrl}`,
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "pm-mask",
        source: "protomaps",
        "source-layer": "mask",
        type: "fill",
        paint: { "fill-color": "#0f1726" },
      },
      {
        id: "pm-earth",
        source: "protomaps",
        "source-layer": "earth",
        type: "fill",
        paint: { "fill-color": "#121d2e" },
      },
      {
        id: "pm-water",
        source: "protomaps",
        "source-layer": "water",
        type: "fill",
        paint: { "fill-color": "#164969", "fill-opacity": 0.85 },
      },
      {
        id: "pm-landuse",
        source: "protomaps",
        "source-layer": "landuse",
        type: "fill",
        paint: { "fill-color": "#1b2940", "fill-opacity": 0.72 },
      },
      {
        id: "pm-buildings",
        source: "protomaps",
        "source-layer": "buildings",
        type: "fill",
        paint: {
          "fill-color": "#5a7392",
          "fill-opacity": 0.92,
          "fill-outline-color": "#94a8c4",
        },
      },
      {
        id: "pm-roads",
        source: "protomaps",
        "source-layer": "roads",
        type: "line",
        paint: {
          "line-color": "#a9bdd5",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 3.2, 18, 5.6],
          "line-opacity": 0.82,
        },
      },
      {
        id: "pm-road-labels",
        source: "protomaps",
        "source-layer": "roads",
        type: "symbol",
        filter: ["has", "name"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 16, 11, 18, 13],
          "text-padding": 2,
        },
        paint: {
          "text-color": "#c9d6e7",
          "text-halo-color": "#07101d",
          "text-halo-width": 1.2,
          "text-opacity": 0.76,
        },
      },
    ],
  };
}

function flattenTacticalRoadCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function tacticalSegmentInMap(a, b) {
  const [cols, rows] = getTacticalGridDims();
  const margin = 1;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX >= -margin && minX <= cols + margin && maxY >= -margin && minY <= rows + margin;
}

function scaleRoadSegmentsFromExport(data, toCols, toRows) {
  if (!data?.segments?.length) return [];
  const from = data.mapSize || [30, 30];
  const fc = Math.max(1, from[0]);
  const fr = Math.max(1, from[1]);
  const sx = toCols / fc;
  const sy = toRows / fr;
  return data.segments.map((seg) => ({
    a: { x: seg.a.x * sx, y: seg.a.y * sy },
    b: { x: seg.b.x * sx, y: seg.b.y * sy },
  }));
}

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
  if (t === "drone") return false;
  return t === "ground_rescue" || t === "ground_clear" || t === "ugv";
}

function moveAgentOnRoad(agent, targetCell, targetKey) {
  if (!ugvRoadNetwork?.available) {
    moveAgentToward(agent, targetCell);
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

function rebuildTacticalRoadNetwork() {
  if (!tacticalBaseMap || !tacticalBaseMapReady) return;
  let features = [];
  try {
    features = tacticalBaseMap.querySourceFeatures("protomaps", { sourceLayer: "roads" });
  } catch (err) {
    console.warn("[tactical basemap] road query failed:", err);
    return;
  }
  const segments = [];
  for (const feature of features) {
    for (const line of flattenTacticalRoadCoords(feature.geometry)) {
      for (let i = 1; i < line.length; i += 1) {
        const a = tacticalLngLatToGrid(line[i - 1][0], line[i - 1][1]);
        const b = tacticalLngLatToGrid(line[i][0], line[i][1]);
        if (tacticalSegmentInMap(a, b)) segments.push({ a, b });
      }
    }
  }
  if (segments.length) {
    tacticalRoadSegments = segments;
    tacticalRoadNetworkReady = true;
    window.__arcSimulationRoadSegments = tacticalRoadSegments;
  }
  if (!ugvRoadNetwork?.available && tacticalRoadSegments.length && state?.map?.size) {
    tryUgvRoadNetworkFromLiveSegments();
  }
}

/* ------------------------------------------------------------------------- */
/* Tactical buildings — query PMTiles building footprints + tag damage      */
/* ------------------------------------------------------------------------- */
function flattenTacticalPolygonCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates[0] || []];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((poly) => poly[0] || []);
  }
  return [];
}

function polygonAreaAndCentroid(ring) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  if (ring.length < 3) return { area: 0, centroid: [0, 0] };
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = xj * yi - xi * yj;
    twiceArea += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  const area = Math.abs(twiceArea) * 0.5;
  if (area < 1e-9) {
    const sx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const sy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return { area: 0, centroid: [sx, sy] };
  }
  return { area, centroid: [cx / (3 * twiceArea), cy / (3 * twiceArea)] };
}

function pointInPolygon(x, y, ring) {
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

function polygonBounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function simplifyRing(ring, maxVerts) {
  if (ring.length <= maxVerts) return ring;
  const stride = Math.ceil(ring.length / maxVerts);
  const out = [];
  for (let i = 0; i < ring.length; i += stride) out.push(ring[i]);
  if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
  return out;
}

function rebuildTacticalBuildingFootprints() {
  if (!tacticalBaseMap || !tacticalBaseMapReady) return;
  let features = [];
  try {
    features = tacticalBaseMap.querySourceFeatures("protomaps", { sourceLayer: "buildings" });
  } catch (err) {
    console.warn("[tactical basemap] building query failed:", err);
    return;
  }
  const seen = new Set();
  const out = [];
  const [cols, rows] = getTacticalGridDims();
  for (const feature of features) {
    const fid = feature.id ?? feature.properties?.["@id"] ?? feature.properties?.id;
    const key = fid != null ? String(fid) : `${feature.geometry?.type}:${JSON.stringify(feature.geometry?.coordinates?.[0]?.[0] || [])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rings = flattenTacticalPolygonCoords(feature.geometry);
    for (const ringLngLat of rings) {
      if (!ringLngLat || ringLngLat.length < 3) continue;
      const gridRing = ringLngLat.map((c) => {
        const p = tacticalLngLatToGrid(c[0], c[1]);
        return [p.x, p.y];
      });
      const bounds = polygonBounds(gridRing);
      if (bounds.maxX < -1 || bounds.minX > cols + 1) continue;
      if (bounds.maxY < -1 || bounds.minY > rows + 1) continue;
      const simplified = simplifyRing(gridRing, 16);
      const { area, centroid } = polygonAreaAndCentroid(simplified);
      if (area < 0.05) continue;
      out.push({
        id: `B${out.length + 1}`,
        polygon: simplified,
        centroid,
        area,
        bounds,
        damage: "intact",
      });
    }
  }
  if (out.length) {
    tacticalBuildingFootprints = out;
    tacticalBuildingsReady = true;
    if (state) applyBuildingsToState();
  }
}

function tagBuildingDamage(buildings, riskZones, cellSize) {
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

function buildBlockadeCandidatePool(damagedBuildings, roadSegments, gridSize) {
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

function installTacticalPmtilesProtocol() {
  const ml = globalThis.maplibregl;
  const Pm = globalThis.pmtiles;
  if (!ml || !Pm) return;
  if (!tacticalPmtilesProtoInstalled) {
    tacticalPmtilesProtocol = new Pm.Protocol();
    ml.addProtocol("pmtiles", tacticalPmtilesProtocol.tile);
    tacticalPmtilesProtoInstalled = true;
  }
  tacticalPmtilesProtocol.add(new Pm.PMTiles(tacticalPmtilesUrl));
}

function initTacticalBasemap() {
  const ml = globalThis.maplibregl;
  const Pm = globalThis.pmtiles;
  if (tacticalBaseMap || !ml || !Pm) return;
  const mount = document.getElementById("tacticalBasemap");
  if (!mount) return;

  tacticalPmtilesUrl = resolveTacticalPmtilesUrl();
  try {
    installTacticalPmtilesProtocol();
    tacticalBaseMap = new ml.Map({
      container: mount,
      style: makeTacticalBasemapStyle(),
      bounds: [
        [GEO_BOUNDS_300M.southWest[1], GEO_BOUNDS_300M.southWest[0]],
        [GEO_BOUNDS_300M.northEast[1], GEO_BOUNDS_300M.northEast[0]],
      ],
      fitBoundsOptions: { padding: 0, duration: 0 },
      interactive: false,
      attributionControl: false,
    });
    tacticalBaseMap.on("load", () => {
      tacticalBaseMapReady = true;
      tacticalBaseMap.fitBounds(
        [
          [GEO_BOUNDS_300M.southWest[1], GEO_BOUNDS_300M.southWest[0]],
          [GEO_BOUNDS_300M.northEast[1], GEO_BOUNDS_300M.northEast[0]],
        ],
        { padding: 0, duration: 0 },
      );
      syncTacticalBasemapSize();
    });
    tacticalBaseMap.on("idle", () => {
      rebuildTacticalRoadNetwork();
      rebuildTacticalBuildingFootprints();
    });
    tacticalBaseMap.on("error", (e) => {
      console.warn("[tactical basemap] map error:", e?.error || e);
    });
  } catch (err) {
    console.warn("[tactical basemap] initialization failed:", err);
  }
}

function wireTacticalBasemapResize() {
  const frame = canvas?.closest(".canvas-frame");
  if (!frame || typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => syncTacticalBasemapSize());
  ro.observe(frame);
}

let defaultScenario;

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
    if (liveAiModeEnabled) void probeLmStudio();
    else setAiStatusBadge(false);
  })
  .catch((err) => {
    console.error(`[simulation] Failed to load /simulation/data/scenarios/${scenarioFile}:`, err);
    const id = document.getElementById("briefText");
    if (id) {
      id.textContent = `Could not load scenario file “${scenarioFile}”. Use ?scenario=scenario_002.json or check the console.`;
    }
  });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reset() {
  state = clone(initialScenario);
  state.timestep = 0;
  state.rescued = 0;
  lastTickAt = performance.now();

  // ── 1. Clear all route/targeting state ────────────────────────────────────
  roadRouteCache.clear();
  trails.clear();
  for (const agent of state.agents) {
    agent.prevLocation = [...agent.location];
    agent._rescueTarget = null;       // clear committed-target lock for every agent
    trails.set(agent.id, [{ x: agent.location[0], y: agent.location[1] }]);
  }

  // ── 2. Rebuild road network FIRST so generatePlan / executeActions are consistent
  refreshUgvRoadNetwork();
  if (tacticalBaseMapReady) {
    rebuildTacticalRoadNetwork();
    rebuildTacticalBuildingFootprints();
  }
  applyBuildingsToState();

  // ── 3. Generate fresh plan (now road network is ready)
  survivalHistory.length = 0;
  recordSurvivalSample();
  plan = generatePlan();

  // ── 4. Clear UI feeds and render new state
  resetDecisionFeeds();
  cotFeedPrependedStep = -999;
  lastCotFeedWallMs = 0;
  cotFeedTranscriptChunks.length = 0;
  if (cotCarouselTrack) cotCarouselTrack.innerHTML = "";
  const log = document.getElementById("eventLog");
  if (log) log.innerHTML = "";

  stopAuto();
  renderOnce();
  startRafLoop();
  if (liveAiModeEnabled) scheduleLiveAiRound(plan);
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
  if (liveAiModeEnabled) scheduleLiveAiRound(plan);
  return true;
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
    // Keep survival_pct in sync — mirrors demo_player per-victim baseline
    victim.survival_pct = parseFloat(((victim.hp / victim.hp_max) * 100).toFixed(1));
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
      if (!victim) continue;
      const rk = `${action.agent}|${action.task}|${action.target}`;
      if (agentUsesRoadRouting(agent)) {
        moveAgentOnRoad(agent, victim.location, rk);
      } else {
        moveAgentToward(agent, victim.location);
      }
      // Drone overhead confirms an unknown victim's location → mark as trapped
      if (agent.type === "drone" && victim.status === "unknown"
          && nearCell(agent.location, victim.location, 3)) {
        victim.status = "trapped";
      }
      // Ground unit within reach → rescue (covers ground_rescue, ground_armored, and clearers acting as rescue)
      const isGroundRescuer = agent.type === "ground_rescue"
        || agent.type === "ground_armored"
        || agent.type === "ground_clear";
      if (isGroundRescuer && (victim.status === "trapped" || victim.status === "unknown")
          && nearCell(agent.location, victim.location, 1.5)) {
        victim.status = "rescued";
        state.rescued += 1;
        agent._rescueTarget = null;  // release lock so agent picks next target
      }
    } else if (action.target?.startsWith("Relay-")) {
      // Dynamic relay anchor — position stored on the action by generatePlan
      const relayPos = action._relayPos ?? [
        Math.round(state.map.size[0] * 0.47),
        Math.round(state.map.size[1] * 0.37),
      ];
      const rk = `${action.agent}|${action.task}|${action.target}`;
      if (agentUsesRoadRouting(agent)) {
        moveAgentOnRoad(agent, relayPos, rk);
      } else {
        moveAgentToward(agent, relayPos);
      }
    } else if (action.target?.startsWith("K")) {
      const blockade = state.map.blocked_cells.find((item) => item.id === action.target);
      if (!blockade) continue;
      const rk = `${action.agent}|${action.task}|${action.target}`;
      if (agentUsesRoadRouting(agent)) {
        moveAgentOnRoad(agent, blockade.location, rk);
      } else {
        moveAgentToward(agent, blockade.location);
      }
    }

    // Drain rates aligned with demo_player (timeline.json):
    //   UAV: 0.001/step on 0-1 scale → 0.1/step on 0-100 scale
    //   UGV: near-zero in demo_player  → 0.05/step (keeps display alive without fast depletion)
    agent.battery = Math.max(0, agent.battery - (agent.type === "drone" ? 0.1 : 0.05));
  }
}

function moveAgentToward(agent, target) {
  if (!target) return;
  const [x, y] = agent.location;
  const dx = target[0] - x;
  const dy = target[1] - y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.05) return;
  // Move exactly `speed` cells per step along the straight-line vector.
  // Old formula used speed/Chebyshev_steps which made agents ~10× too slow.
  const speed = agent.speed || 1;
  const scale = Math.min(speed, dist) / dist;
  agent.location = [roundCoord(x + dx * scale), roundCoord(y + dy * scale)];
}

function roundCoord(value) {
  return Math.round(value * 10) / 10;
}

function sameCell(a, b) {
  return Math.round(a[0]) === b[0] && Math.round(a[1]) === b[1];
}

/** Road-routing stops at the nearest road node, which may be up to ~1 cell away
 *  from an off-road victim. Use this for rescue trigger checks. */
function nearCell(a, b, radius = 1.5) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

function generatePlan() {
  const candidates  = rankVictims();
  const allBlockades = state.map.blocked_cells.filter((b) => b.status === "blocked");

  // Group ALL configured agents by role — no longer capped at "first of each type"
  const scouts   = state.agents.filter((a) => a.role === "scout");
  const relays   = state.agents.filter((a) => a.role === "relay");
  const rescues  = state.agents.filter((a) => a.role === "rescue" || a.type === "ground_rescue");
  const clearers = state.agents.filter((a) => a.role === "clear_blockade" || a.type === "ground_clear");

  const offlineVics = candidates.filter((c) => c.communication_status !== "available");
  const needsRelay  = offlineVics.length > 0 && (offlineVics[0]?.score ?? 0) > 0.3;

  const missionPlan       = [];
  const assignedVictimIds = new Set();   // prevent two ground units targeting same victim

  // ── SCOUTS ─────────────────────────────────────────────────────────────────
  // Each scout drone confirms a different top-priority victim.
  // Excess scouts (more drones than victims) hover the last known victim.
  scouts.forEach((scout, i) => {
    const target = candidates[i] || candidates[candidates.length - 1];
    if (!target) return;
    missionPlan.push({
      agent: scout.id,
      task: "aerial_confirmation",
      target: target.id,
      safety_note: "Keep flight path above blocked roads and avoid prolonged hover over collapse-risk cells."
    });
  });

  // ── RELAYS ──────────────────────────────────────────────────────────────────
  // Each relay drone is placed at a dynamically computed anchor along the
  // base→offline-victim vector, forming a daisy-chain for multi-hop coverage.
  // If no offline victims exist, redirect relay drones as additional scouts.
  relays.forEach((relay, i) => {
    if (!needsRelay) {
      // Re-purpose as scout for victims beyond current scout coverage
      const target = candidates[scouts.length + i] || candidates[candidates.length - 1];
      if (target) {
        missionPlan.push({
          agent: relay.id,
          task: "aerial_confirmation",
          target: target.id,
          safety_note: "No relay needed — acting as supplementary scout."
        });
      }
      return;
    }
    const anchor = computeRelayAnchor(i, offlineVics);
    missionPlan.push({
      agent: relay.id,
      task: "deploy_relay",
      target: `Relay-R${i + 1}`,
      _relayPos: anchor,
      safety_note: "Hold relay coverage between base and the weak communication zone."
    });
  });

  // ── RESCUE UGVs ────────────────────────────────────────────────────────────
  // Each rescue UGV locks onto a unique victim. Lock persists across steps so
  // UGVs don't constantly swap targets as the ranking shifts.
  // An emergency override fires when a *different* victim has < 3 steps left.
  rescues.forEach((rescue) => {
    const committed      = rescue._rescueTarget;
    const committedStill = committed
      && !assignedVictimIds.has(committed)
      && candidates.find((c) => c.id === committed && c.survival_steps > 0);
    const emergency = candidates.find(
      (c) => c.survival_steps < 3 && !assignedVictimIds.has(c.id) && c.id !== committed
    );
    const nextBest = candidates.find((c) => !assignedVictimIds.has(c.id));

    const target = emergency || committedStill || nextBest;
    if (!target) return;

    assignedVictimIds.add(target.id);
    rescue._rescueTarget = target.id;
    missionPlan.push({
      agent: rescue.id,
      task: "ground_rescue",
      target: target.id,
      safety_note: "Use the safer corridor and do not enter blocked or extreme collapse-risk cells."
    });
  });

  // ── CLEARERS ───────────────────────────────────────────────────────────────
  // Each clearer tackles a different blockade.
  // Once all blockades are cleared, clearers switch to supplementary rescue.
  clearers.forEach((clearer, i) => {
    const blockade = allBlockades[i];
    if (blockade) {
      missionPlan.push({
        agent: clearer.id,
        task: "clear_blockade",
        target: blockade.id,
        safety_note: "Clear one blockade at a time; parallel clearing is not counted as extra benefit."
      });
      return;
    }
    // No blockade assigned — act as ground rescue
    const committed  = clearer._rescueTarget;
    const committedStill = committed
      && !assignedVictimIds.has(committed)
      && candidates.find((c) => c.id === committed && c.survival_steps > 0);
    const nextBest = candidates.find((c) => !assignedVictimIds.has(c.id));
    const target = committedStill || nextBest;
    if (!target) return;

    assignedVictimIds.add(target.id);
    clearer._rescueTarget = target.id;
    missionPlan.push({
      agent: clearer.id,
      task: "ground_rescue",
      target: target.id,
      safety_note: "No blockades remaining — assisting rescue operations."
    });
  });

  const top = candidates[0] ?? null;
  return {
    commander_briefing: makeBrief(candidates, needsRelay && relays.length > 0, allBlockades[0] ?? null),
    priority_order: candidates.map((c) => c.id),
    mission_plan: missionPlan,
    human_confirmation_required: [
      top ? `Approve ground approach to ${top.id}.` : "No active victims.",
      needsRelay
        ? `Confirm relay deployment to cover ${offlineVics.length} offline victim(s).`
        : "Relay not required for current targets."
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
      // Threshold lowered to 5% to stay meaningful with the slower drain rate
      const energyFeasible = bestAgent.agent.battery - distance * 0.8 >= 5 ? 1 : 0;
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
        hp_max: victim.hp_max,
        survival_pct: victim.survival_pct,
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
  const score = (agent) => {
    const raw = locationRisk(victim.location, agent.type);
    // Armored vehicles are hazard-immune — treat any risk-zone exposure as
    // ~third the cost so they win contests inside fire/collapse cells.
    const immune = agent.risk_immune || agent.type === "ground_armored";
    return immune ? raw * 0.3 : raw;
  };
  let options = state.agents
    .filter((agent) => agent.role !== "relay" && agent.role !== "clear_blockade")
    .map((agent) => ({
      agent,
      pathRisk: score(agent),
      blocked: agent.type !== "drone" && agent.type !== "balloon" && isBlockedNear(victim.location)
    }));
  if (!options.length && state.agents.length) {
    options = state.agents.map((agent) => ({
      agent,
      pathRisk: score(agent),
      blocked: agent.type !== "drone" && agent.type !== "balloon" && isBlockedNear(victim.location)
    }));
  }
  if (!options.length) {
    return { agent: { id: "—", battery: 0, type: "drone" }, pathRisk: 1, blocked: false };
  }
  return options.sort((a, b) => a.pathRisk - b.pathRisk)[0];
}

function lifeSignalConfidence(victim) {
  // Aligned with demo_player: only thermal_signal is tracked per victim
  return victim.thermal_signal;
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

/**
 * Compute a relay drone anchor position for relay index `idx`.
 * Places each relay along the base→offline-victim vector at increasing depth,
 * so multiple relays form a communication daisy-chain.
 * @param {number} idx  - relay index (0 = closest to base, 1 = further, …)
 * @param {Array}  offlineVicCandidates - ranked candidates with comm !== "available"
 */
function computeRelayAnchor(idx, offlineVicCandidates) {
  const base = state.map.base;
  const [cols, rows] = state.map.size;
  const vCand = offlineVicCandidates[idx % Math.max(1, offlineVicCandidates.length)];
  const vObj  = vCand && state.victims.find((v) => v.id === vCand.id);
  if (!vObj) {
    // Fallback: spread anchors toward map centre
    return [
      Math.round(cols * (0.40 + idx * 0.12)),
      Math.round(rows * (0.35 + idx * 0.10)),
    ];
  }
  // Place relay at 55 % (relay-0), 70 % (relay-1), … of the base→victim vector
  const t = Math.min(0.55 + idx * 0.18, 0.80);
  return [
    Math.round(base[0] + (vObj.location[0] - base[0]) * t),
    Math.round(base[1] + (vObj.location[1] - base[1]) * t),
  ];
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

function agentDialogueClass(agent) {
  if (!agent) return "mesh";
  return agent.type === "drone" ? "drone" : "ugv";
}

function pickDialoguePeer(action, agents) {
  const others = agents.filter((a) => a.id !== action.agent);
  if (!others.length) return null;
  if (action.task === "aerial_confirmation") {
    return others.find((a) => a.role === "rescue" || a.type === "ground_rescue")
      || others.find((a) => a.role === "relay")
      || others[0];
  }
  if (action.task === "deploy_relay") {
    return others.find((a) => a.role === "scout" || a.type === "drone") || others[0];
  }
  if (action.task === "vibration_audio_verification" || action.task === "ground_rescue") {
    return others.find((a) => a.type === "drone") || others[0];
  }
  if (action.task === "clear_blockade") {
    return others.find((a) => a.type === "drone") || others[0];
  }
  return others[0];
}

function batteryPctLabel(agent) {
  if (!agent) return "—";
  const b = agent.battery;
  return `${Math.round(b <= 1 ? b * 100 : b)}%`;
}

function buildFleetDialogueSlides(plan) {
  if (
    liveAiModeEnabled &&
    liveAiConnected === true &&
    liveAiCache.fleetSlides &&
    liveAiCache.tick === state?.timestep
  ) {
    return liveAiCache.fleetSlides;
  }

  const dDlg = fleetDialogueCot?.dialogue ?? FLEET_DIALOGUE_COT_BUILTIN.dialogue;
  const standby = dDlg.standby ?? FLEET_DIALOGUE_COT_BUILTIN.dialogue.standby;
  if (!state || !plan) {
    return [
      {
        title: standby.title,
        turns: [{ kind: "cot", who: standby.who, lines: [...(standby.lines || [])] }],
      },
    ];
  }

  const t = state.timestep;
  const padT = `T+${String(t).padStart(3, "0")}`;
  const candidates = rankVictims();
  const agents = state.agents;
  const activeBlock = state.map.blocked_cells.find((b) => b.status === "blocked");
  const slides = [];

  const orch = dDlg.orchestrator;
  const rankingLine = candidates.length
    ? `${orch.rankingPrefix}${candidates
        .map((c) => interpolate(orch.rankingItemTemplate, { padT, id: c.id, score: c.score.toFixed(2) }))
        .join(", ")}${orch.rankingSuffix}`
    : orch.noHypotheses;

  const orchLines = [interpolate(orch.heartbeatFused, { padT }), rankingLine];
  if (candidates[0]) {
    const top = candidates[0];
    orchLines.push(
      interpolate(orch.leadVictim, {
        padT,
        id: top.id,
        survivalPct: top.survival_pct,
        survivalSteps: top.survival_steps,
        comm: top.communication_status,
        bestAgent: top.best_agent,
      })
    );
  }
  orchLines.push(
    interpolate(orch.policy, { padT, taskCount: plan.mission_plan?.length ?? 0 })
  );

  slides.push({
    title: interpolate(orch.slideTitleTemplate, { padT }),
    turns: [{ kind: "cot", who: orch.who, lines: orchLines }],
  });

  const actions = plan.mission_plan || [];
  const ag = dDlg.agentSlide;
  const slideMax = cotFeedSlideMax();
  let shown = 0;
  for (const action of actions) {
    if (shown >= slideMax) break;
    const agent = agents.find((a) => a.id === action.agent);
    const peer = pickDialoguePeer(action, agents);
    const cls = agentDialogueClass(agent);
    const taskHuman = action.task.replace(/_/g, " ");
    const loc = agent?.location?.map((n) => Math.round(n)).join(", ") || "—";
    const cotLines = [
      interpolate(ag.goal, { padT, agent: action.agent, taskHuman, target: action.target }),
      interpolate(cls === "drone" ? ag.nodeUav : ag.nodeUgv, {
        padT,
        agent: action.agent,
        battery: batteryPctLabel(agent),
        loc,
      }),
    ];
    if (action.safety_note) {
      cotLines.push(interpolate(ag.riskNote, { padT, note: action.safety_note }));
    }
    cotLines.push(
      interpolate(ag.meshAck, { padT, peer: peer?.id || ag.peerFallback })
    );

    const radioTo = peer?.id || ag.radioToAllCall;
    const radioOut =
      cls === "drone"
        ? interpolate(ag.radioDroneOut, { padT, agent: action.agent, radioTo, target: action.target })
        : interpolate(ag.radioUgvOut, { padT, agent: action.agent, radioTo, target: action.target });

    let radioIn;
    if (peer && peer.id !== action.agent) {
      const pr = peer.role || peer.type || "node";
      radioIn =
        pr === "relay"
          ? interpolate(ag.radioInRelay, { padT, peerId: peer.id, agent: action.agent })
          : interpolate(ag.radioInOther, { padT, peerId: peer.id, agent: action.agent });
    } else {
      radioIn = interpolate(ag.meshAwait, { padT, agent: action.agent });
    }

    slides.push({
      title: interpolate(ag.slideTitleTemplate, { padT, agent: action.agent, taskHuman }),
      turns: [
        {
          kind: "cot",
          who: interpolate(ag.whoTemplate, { padT, agent: action.agent }),
          lines: cotLines,
        },
        { kind: "msg", who: action.agent, to: radioTo, cls, text: radioOut },
        {
          kind: "msg",
          who: peer?.id || "mesh",
          to: action.agent,
          cls: peer ? agentDialogueClass(peer) : "mesh",
          text: radioIn,
        },
      ],
    });
    shown += 1;
  }

  const hasClearTask = actions.some((a) => a.task === "clear_blockade");
  const tn = dDlg.trafficNote;
  const ms = dDlg.meshStandby;
  if (activeBlock && !hasClearTask) {
    slides.push({
      title: interpolate(tn.slideTitleTemplate, { padT }),
      turns: [
        {
          kind: "cot",
          who: tn.who,
          lines: [
            interpolate(tn.lineBlock, { padT, blockId: activeBlock.id }),
            tn.lineRecommend,
          ],
        },
      ],
    });
  } else if (slides.length === 1) {
    slides.push({
      title: interpolate(ms.slideTitleTemplate, { padT }),
      turns: [
        {
          kind: "msg",
          who: ms.who,
          to: ms.to,
          cls: "mesh",
          text: interpolate(ms.text, { padT }),
        },
      ],
    });
  }

  return slides;
}

function createCotTurnElement(turn) {
  const wrap = document.createElement("div");
  wrap.className = `cot-turn ${turn.kind} ${turn.cls || ""}`.trim();
  const feedUi = fleetDialogueCot?.ui?.feed ?? FLEET_DIALOGUE_COT_BUILTIN.ui.feed;

  if (turn.kind === "cot") {
    // ── CoT reasoning block ────────────────────────────────────────
    const lab = document.createElement("div");
    lab.className = "cot-turn-label";
    const dot = document.createElement("span");
    dot.className = "cot-label-dot";
    lab.append(dot, feedUi.chainOfThoughtLabel || "Chain-of-thought");

    const head = document.createElement("div");
    head.className = "cot-turn-head";
    head.textContent = turn.who;

    const bub = document.createElement("div");
    bub.className = "cot-bubble";
    const ul = document.createElement("ul");
    ul.className = "cot-line-list";
    for (const line of turn.lines || []) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    }
    bub.appendChild(ul);
    wrap.append(lab, head, bub);

  } else {
    // ── Radio comms message ────────────────────────────────────────
    const head = document.createElement("div");
    head.className = "cot-turn-head";

    const csOut = document.createElement("span");
    csOut.className = "cot-callsign cot-callsign-out";
    csOut.textContent = turn.who;

    const arrow = document.createElement("span");
    arrow.className = "cot-arrow";
    arrow.textContent = feedUi.radioArrow || "▶";

    const csIn = document.createElement("span");
    csIn.className = "cot-callsign-in";
    csIn.textContent = turn.to;

    head.append(csOut, arrow, csIn);

    const bub = document.createElement("div");
    bub.className = "cot-bubble";
    bub.textContent = turn.text;

    wrap.append(head, bub);
  }
  return wrap;
}

function createCotFeedBlock(timestep, slides) {
  const block = document.createElement("div");
  block.className = "cot-feed-block";
  block.dataset.timestep = String(timestep);
  const padT = `T+${String(timestep).padStart(3, "0")}`;
  const feedUi = fleetDialogueCot?.ui?.feed ?? FLEET_DIALOGUE_COT_BUILTIN.ui.feed;

  // Header bar with live dot + optional LIVE badge
  const head = document.createElement("header");
  head.className = "cot-feed-block-head";

  const dot = document.createElement("span");
  dot.className = "cot-live-dot";
  head.appendChild(dot);

  const label = document.createElement("span");
  label.textContent = interpolate(feedUi.blockHeadTemplate, { padT });
  head.appendChild(label);

  const liveBadge = document.createElement("span");
  liveBadge.className = "cot-live-badge";
  liveBadge.textContent = feedUi.liveBadge || "● LIVE";
  head.appendChild(liveBadge);

  block.appendChild(head);

  for (const slide of slides) {
    const sec = document.createElement("section");
    sec.className = "cot-feed-section";

    const ht = document.createElement("h4");
    ht.className = "cot-feed-section-title";
    ht.textContent = slide.title;
    sec.appendChild(ht);

    for (const t of slide.turns) sec.appendChild(createCotTurnElement(t));
    block.appendChild(sec);
  }
  return block;
}

function formatSlidesTranscriptChunk(timestep, slides) {
  const padT = `T+${String(timestep).padStart(3, "0")}`;
  const tr = fleetDialogueCot?.ui?.transcript ?? FLEET_DIALOGUE_COT_BUILTIN.ui.transcript;
  const lines = [interpolate(tr.sectionHeaderTemplate, { padT })];
  const bullet = tr.cotBulletPrefix ?? "  • ";
  for (const s of slides) {
    lines.push(`## ${s.title}`);
    for (const turn of s.turns) {
      if (turn.kind === "cot") {
        lines.push(interpolate(tr.cotBracketTemplate, { padT, who: turn.who }));
        for (const ln of turn.lines || []) lines.push(bullet + ln);
      } else {
        lines.push(
          interpolate(tr.msgLineTemplate, {
            padT,
            who: turn.who,
            to: turn.to,
            text: turn.text,
          })
        );
      }
    }
  }
  return lines.join("\n");
}

function updateCotFeedMeta(slides) {
  const el = cotSlideLabel;
  if (!el || !state) return;
  const panel = fleetDialogueCot?.ui?.panel ?? FLEET_DIALOGUE_COT_BUILTIN.ui.panel;
  const metaT =
    fleetDialogueCot?.ui?.meta?.latestTemplate ??
    FLEET_DIALOGUE_COT_BUILTIN.ui.meta.latestTemplate;
  const padT = `T+${String(state.timestep).padStart(3, "0")}`;
  const head = slides[0]?.title ?? panel?.slideLabelDefault ?? "—";
  el.textContent = interpolate(metaT, { padT, head });
}

/** Scroll viewport so the newest heartbeat (last in DOM, column-reverse stack) is at the top. */
function flushScrollToLatestCot() {
  const vp = cotCarouselViewport;
  const track = cotCarouselTrack;
  if (!vp || !track?.lastElementChild) return;
  const latest = track.lastElementChild;
  const snap = () => {
    latest.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
  };
  snap();
  requestAnimationFrame(() => {
    snap();
    requestAnimationFrame(snap);
  });
}

function scrollLatestCotIntoView(smooth = true) {
  const track = cotCarouselTrack;
  if (!track?.lastElementChild) return;
  track.lastElementChild.scrollIntoView({
    block: "start",
    inline: "nearest",
    behavior: smooth ? "smooth" : "instant",
  });
}

function updateFleetDialogueCarousel(plan, slidesPrebuilt = null) {
  if (!cotCarouselTrack || !state) return;
  if (cotFeedPrependedStep === state.timestep) return;
  if (timer) {
    const now = performance.now();
    if (now - lastCotFeedWallMs < COT_FEED_AUTO_MIN_MS) return;
    lastCotFeedWallMs = now;
  }
  cotFeedPrependedStep = state.timestep;
  const slides = slidesPrebuilt ?? buildFleetDialogueSlides(plan);
  const block = createCotFeedBlock(state.timestep, slides);
  cotCarouselTrack.appendChild(block);
  // CSS animation defined in styles.css; JS animate() is redundant and conflicts
  block.style.animation = "cot-block-enter 420ms cubic-bezier(0.22,1,0.36,1) both";
  while (cotCarouselTrack.children.length > cotFeedMaxBlocks()) {
    cotCarouselTrack.removeChild(cotCarouselTrack.firstChild);
  }
  cotFeedTranscriptChunks.unshift(formatSlidesTranscriptChunk(state.timestep, slides));
  while (cotFeedTranscriptChunks.length > cotFeedMaxBlocks()) cotFeedTranscriptChunks.pop();
  requestAnimationFrame(() => {
    flushScrollToLatestCot();
  });
}

function formatCotTranscript() {
  const sep =
    fleetDialogueCot?.ui?.transcript?.chunkSeparator ??
    FLEET_DIALOGUE_COT_BUILTIN.ui.transcript.chunkSeparator;
  return cotFeedTranscriptChunks.join(sep);
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
  drawBuildingDamage(cell, t);
  drawRiskZones(cell, t);
  drawBlockades(cell);
  drawVictims(cell, t);
  drawBase(cell);
  drawAgents(cell, t);
}

function drawGrid(cols, rows, cell) {
  ctx.fillStyle = tacticalBaseMapReady ? "rgba(4, 6, 10, 0.14)" : "#04060a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = tacticalBaseMapReady ? "rgba(93, 255, 180, 0.05)" : "rgba(255, 255, 255, 0.04)";
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
  const arterialAlpha = tacticalBaseMapReady ? 0.14 : 0.32;
  ctx.fillStyle = `rgba(60, 80, 110, ${arterialAlpha})`;
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

function tracePolygonPath(ring, cell) {
  if (!ring || ring.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(ring[0][0] * cell, ring[0][1] * cell);
  for (let i = 1; i < ring.length; i += 1) {
    ctx.lineTo(ring[i][0] * cell, ring[i][1] * cell);
  }
  ctx.closePath();
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
  const buildings = state.tacticalBuildings;
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
      ctx.fillStyle = "rgba(48, 32, 22, 0.92)";
      ctx.fill();
      // Crumbled outline (dashed, broken)
      ctx.save();
      ctx.strokeStyle = "rgba(120, 85, 50, 0.85)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 4]);
      tracePolygonPath(b.polygon, cell);
      ctx.stroke();
      ctx.restore();
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
        ctx.fillStyle = palette[i % palette.length];
        const w = 2 + rnd(i + 100) * 2.4;
        const h = 1.6 + rnd(i + 101) * 1.8;
        ctx.save();
        ctx.translate(sx * cell, sy * cell);
        ctx.rotate(rnd(i + 102) * Math.PI);
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }
      // Dust plume from the wreckage
      const [cx, cy] = b.centroid;
      for (let j = 0; j < 3; j += 1) {
        const rise = ((t * 0.28 + j * 0.4 + rnd(j + 200)) % 1.5);
        const drift = Math.sin(t * 0.4 + j * 1.3 + seed * 0.001) * 1.4;
        const radius = (2.4 + rise * 6) * (cell / 14);
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.42 - rise * 0.3);
        ctx.fillStyle = "rgba(80, 65, 55, 1)";
        ctx.beginPath();
        ctx.arc((cx + drift) * cell, (cy - rise * 4) * cell, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (b.damage === "burning") {
      // Bright glowing fill that pulses dramatically
      const pulse = 0.55 + Math.sin(t * 2.2 + seed * 0.001) * 0.25;
      tracePolygonPath(b.polygon, cell);
      ctx.fillStyle = `rgba(255, 130, 55, ${0.55 * pulse})`;
      ctx.fill();
      // Inner core glow
      tracePolygonPath(b.polygon, cell);
      const [cx, cy] = b.centroid;
      const innerGlow = ctx.createRadialGradient(
        cx * cell, cy * cell, 0,
        cx * cell, cy * cell, Math.max((b.bounds.maxX - b.bounds.minX), (b.bounds.maxY - b.bounds.minY)) * cell * 0.7
      );
      innerGlow.addColorStop(0, `rgba(255, 220, 130, ${0.55 * pulse})`);
      innerGlow.addColorStop(0.5, `rgba(255, 100, 40, ${0.30 * pulse})`);
      innerGlow.addColorStop(1, "rgba(180, 50, 20, 0)");
      ctx.save();
      ctx.fillStyle = innerGlow;
      ctx.fill();
      ctx.restore();
      // Glowing outline
      ctx.save();
      ctx.strokeStyle = `rgba(255, 130, 50, ${0.85 * pulse})`;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(255, 110, 30, 0.75)";
      ctx.shadowBlur = 12;
      tracePolygonPath(b.polygon, cell);
      ctx.stroke();
      ctx.restore();
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
          ctx.save();
          ctx.globalAlpha = Math.max(0, 0.55 - rise * 0.28);
          ctx.fillStyle = "rgba(28, 22, 22, 1)";
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    } else if (b.damage === "damaged") {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 217, 93, 0.55)";
      ctx.lineWidth = 1.0;
      tracePolygonPath(b.polygon, cell);
      ctx.stroke();
      const { minX, minY, maxX, maxY } = b.bounds;
      ctx.strokeStyle = "rgba(255, 217, 93, 0.35)";
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 3; i += 1) {
        const ax = minX + rnd(i + 1) * (maxX - minX);
        const ay = minY + rnd(i + 2) * (maxY - minY);
        const bx = ax + (rnd(i + 3) - 0.5) * 1.2;
        const by = ay + (rnd(i + 4) - 0.5) * 1.2;
        if (!pointInPolygon(ax, ay, b.polygon)) continue;
        ctx.beginPath();
        ctx.moveTo(ax * cell, ay * cell);
        ctx.lineTo(bx * cell, by * cell);
        ctx.stroke();
      }
      ctx.restore();
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
  for (const zone of state.map.risk_zones) {
    const px = zone.center[0] * cell;
    const py = zone.center[1] * cell;
    const r = zone.radius * cell;
    const hazeR = r * 2.4;
    const isFire = zone.type === "fire";
    const haze = ctx.createRadialGradient(px, py, r * 0.4, px, py, hazeR);
    if (isFire) {
      haze.addColorStop(0, "rgba(80, 25, 10, 0.42)");
      haze.addColorStop(0.55, "rgba(60, 30, 20, 0.18)");
      haze.addColorStop(1, "rgba(40, 30, 25, 0)");
    } else {
      haze.addColorStop(0, "rgba(35, 30, 25, 0.48)");
      haze.addColorStop(0.55, "rgba(40, 38, 38, 0.22)");
      haze.addColorStop(1, "rgba(35, 35, 40, 0)");
    }
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(px, py, hazeR, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const zone of state.map.risk_zones) {
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
      const core = ctx.createRadialGradient(px, py, 0, px, py, r);
      core.addColorStop(0, `rgba(255, 150, 60, ${0.55 * pulse})`);
      core.addColorStop(0.45, `rgba(255, 90, 30, ${0.42 * pulse})`);
      core.addColorStop(1, "rgba(180, 50, 20, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      // Ember sparks across the zone — many small bright dots, animated
      const emberCount = Math.floor(r * 0.6);
      for (let i = 0; i < emberCount; i += 1) {
        const ang = rnd(i * 2) * Math.PI * 2;
        const rad = Math.sqrt(rnd(i * 2 + 1)) * r * 0.95;
        const flicker = 0.5 + Math.sin(t * 4.0 + i * 1.7 + seed * 0.001) * 0.5;
        const ex = px + Math.cos(ang) * rad;
        const ey = py + Math.sin(ang) * rad;
        ctx.fillStyle = `rgba(255, ${160 + Math.floor(flicker * 70)}, 40, ${0.35 + flicker * 0.5})`;
        ctx.fillRect(ex - 0.9, ey - 0.9, 1.8, 1.8);
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
          ctx.save();
          ctx.globalAlpha = Math.max(0, 0.55 - rise * 0.32);
          ctx.fillStyle = "rgba(28, 22, 22, 1)";
          ctx.beginPath();
          ctx.arc(sx + ox, sy + oy, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Bright glowing perimeter ring
      ctx.save();
      ctx.strokeStyle = `rgba(255, 120, 40, ${0.6 + Math.sin(t * 2) * 0.18})`;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = "rgba(255, 90, 30, 0.55)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      // Collapse zone — dense rubble field across the radius
      const dust = ctx.createRadialGradient(px, py, 0, px, py, r);
      dust.addColorStop(0, "rgba(70, 55, 40, 0.45)");
      dust.addColorStop(0.6, "rgba(60, 50, 40, 0.30)");
      dust.addColorStop(1, "rgba(60, 50, 40, 0)");
      ctx.fillStyle = dust;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

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
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(rnd(i * 2 + 4) * Math.PI);
        ctx.fillStyle = palette[variant];
        ctx.globalAlpha = 0.72;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }

      // Ground fissures — jagged cracks radiating outward from epicenter
      const fissureCount = 4 + Math.floor(rnd(50) * 3);
      for (let i = 0; i < fissureCount; i += 1) {
        const baseAng = (i / fissureCount) * Math.PI * 2 + rnd(i + 60) * 0.4;
        const len = r * (0.7 + rnd(i + 61) * 0.6);
        let cx = px;
        let cy = py;
        const segments = 6;
        ctx.save();
        ctx.strokeStyle = "rgba(15, 10, 8, 0.85)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 1; s <= segments; s += 1) {
          const step = len / segments;
          const wobble = (rnd(i * 10 + s) - 0.5) * 0.6;
          const ang = baseAng + wobble;
          cx += Math.cos(ang) * step;
          cy += Math.sin(ang) * step;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        // Outer faint glow on fissure
        ctx.strokeStyle = "rgba(255, 200, 120, 0.18)";
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.restore();
      }

      // Central dust column — vertical smoke plume from the epicenter
      for (let j = 0; j < 6; j += 1) {
        const rise = ((t * 0.3 + j * 0.35) % 1.8);
        const drift = Math.sin(t * 0.5 + j * 1.1 + seed * 0.001) * 2.5;
        const ox = drift;
        const oy = -rise * (r * 1.4);
        const radius = (4 + rise * 9) * (cell / 14);
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.45 - rise * 0.26);
        ctx.fillStyle = "rgba(60, 50, 45, 1)";
        ctx.beginPath();
        ctx.arc(px + ox, py + oy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Perimeter ring (subtle)
      ctx.save();
      ctx.strokeStyle = "rgba(140, 110, 80, 0.45)";
      ctx.lineWidth = 1.1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Label
    ctx.fillStyle = isFire ? "rgba(255, 200, 130, 0.95)" : "rgba(220, 200, 175, 0.92)";
    ctx.font = "bold 10px 'JetBrains Mono', 'Courier New', monospace";
    const label = zone.type.toUpperCase();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 4;
    ctx.fillText(label, px - label.length * 3, py + 3);
    ctx.shadowBlur = 0;
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
      const pct = Math.max(0, Math.min(1, victim.survival_pct / 100));
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

function drawBalloon(px, py, cell, battery, commCells, t) {
  const baseR = Math.max(6, cell * 0.42);
  const drift = Math.sin(t * 0.6) * cell * 0.15;
  const cy = py + drift;
  const commR = (commCells || 10) * cell;
  const pulse = 1 + Math.sin(t * 1.2) * 0.04;

  // comm coverage ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, cy, commR * pulse, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(200,180,255,0.05)";
  ctx.fill();
  ctx.strokeStyle = "rgba(200,180,255,0.28)";
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -t * 8;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // sphere
  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#c8b4ff";
  ctx.beginPath();
  ctx.arc(px, cy - baseR * 0.18, baseR, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(200,180,255,0.75)";
  ctx.fill();
  ctx.strokeStyle = "#c8b4ff";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // gondola
  ctx.fillStyle = "#c8b4ff";
  const gw = baseR * 0.85;
  const gh = baseR * 0.45;
  ctx.fillRect(px - gw / 2, cy + baseR * 0.45, gw, gh);

  // tether ropes
  ctx.strokeStyle = "rgba(200,180,255,0.6)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(px - gw / 4, cy + baseR * 0.45);
  ctx.lineTo(px - baseR * 0.45, cy + baseR * 0.18);
  ctx.moveTo(px + gw / 4, cy + baseR * 0.45);
  ctx.lineTo(px + baseR * 0.45, cy + baseR * 0.18);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : "#c8b4ff";
  ctx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  ctx.fillText(`${Math.round(battery * 100)}%`, px + 10, py - 10);
}

function drawArmored(px, py, cell, battery, t, trail) {
  const color = "rgb(255,140,60)";

  // trail
  if (trail && trail.length > 1) {
    ctx.save();
    for (let i = 1; i < trail.length; i += 1) {
      const a = trail[i - 1];
      const b = trail[i];
      const alpha = (i / trail.length) * 0.45;
      ctx.strokeStyle = `rgba(255,140,60,${alpha})`;
      ctx.lineWidth = lerp(0.5, 2, i / trail.length);
      ctx.beginPath();
      ctx.moveTo((a.x + 0.5) * cell, (a.y + 0.5) * cell);
      ctx.lineTo((b.x + 0.5) * cell, (b.y + 0.5) * cell);
      ctx.stroke();
    }
    ctx.restore();
  }

  // hex-ish armored hull
  ctx.save();
  ctx.shadowBlur = 9;
  ctx.shadowColor = color;
  const body = cell * 0.6;
  const half = body / 2;
  const slope = body * 0.28;
  ctx.beginPath();
  ctx.moveTo(px - half + slope, py - half);
  ctx.lineTo(px + half - slope, py - half);
  ctx.lineTo(px + half, py - half + slope);
  ctx.lineTo(px + half, py + half - slope);
  ctx.lineTo(px + half - slope, py + half);
  ctx.lineTo(px - half + slope, py + half);
  ctx.lineTo(px - half, py + half - slope);
  ctx.lineTo(px - half, py - half + slope);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,140,60,0.18)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // tracks
  const trackW = Math.max(2, body * 0.16);
  ctx.fillStyle = color;
  ctx.fillRect(px - half - trackW - 1, py - half + slope, trackW, body - slope * 2);
  ctx.fillRect(px + half + 1, py - half + slope, trackW, body - slope * 2);

  // forward headlight wedge
  const wedge = body * 0.35;
  ctx.beginPath();
  ctx.moveTo(px, py - half - 1);
  ctx.lineTo(px - wedge * 0.5, py - half - wedge);
  ctx.lineTo(px + wedge * 0.5, py - half - wedge);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,200,140,0.25)";
  ctx.fill();

  // turret dot
  ctx.beginPath();
  ctx.arc(px, py, Math.max(1.5, body * 0.13), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  ctx.fillStyle = battery < 0.15 ? "#ff5d6c" : battery < 0.3 ? "#ffd95d" : color;
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
  const cfg = TOAST_CFG[type] || TOAST_CFG.default;
  const layer = document.getElementById("toastLayer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.style.background = cfg.bg;
  el.style.borderLeftColor = cfg.color;
  el.style.color = cfg.color;
  el.textContent = `${cfg.icon} ${description}`;
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
  pushEventLog(type, description);
}

function pushEventLog(type, description) {
  const log = document.getElementById("eventLog");
  if (!log) return;
  const cfg = TOAST_CFG[type] || TOAST_CFG.default;
  const row = document.createElement("div");
  row.className = "event-row";
  row.style.borderLeftColor = cfg.color;
  row.style.color = cfg.color;
  const t = state ? state.timestep : 0;
  row.textContent = `${cfg.icon} [T${String(t).padStart(3, "0")}] ${description}`;
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

function renderPanels() {
  tickLabel.textContent = String(state.timestep).padStart(3, "0");
  if (rescuedCount.textContent !== String(state.rescued)) {
    rescuedCount.textContent = state.rescued;
  }

  const candidates = rankVictims();
  priorityList.innerHTML = candidates.map((candidate) => `
    <div class="row">
      <strong>${candidate.id}</strong>
      <div>
        <div class="bar" style="--value: ${candidate.score * 100}%"><i></i></div>
        <span>${candidate.survival_pct}% · ${candidate.survival_steps}t · ${candidate.communication_status}</span>
      </div>
      <b class="tag">${candidate.score.toFixed(2)}</b>
    </div>
  `).join("");

  agentList.innerHTML = state.agents.map((agent) => `
    <div class="row">
      <strong>${agent.id}</strong>
      <div>
        <div class="bar" style="--value: ${agent.battery}%"><i></i></div>
        <span>${agent.role} · ${agent.location.map((item) => Math.round(item)).join(", ")}</span>
      </div>
      <b class="tag">${Math.round(agent.battery)}%</b>
    </div>
  `).join("");

  syncThinkingFeed(plan);
  syncBriefingFeed(plan);
  syncLiveAiHudPending();
  const fleetDialogueSlides = buildFleetDialogueSlides(plan);
  updateCotFeedMeta(fleetDialogueSlides);
  updateFleetDialogueCarousel(plan, fleetDialogueSlides);
  updateCommandKpis(candidates);
  drawSurvivalChart();
  updateAgentCards();
}

function drawSurvivalChart() {
  if (!chartCtx || !survivalChart || !state) return;
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

  const VIC_BAND = Math.min(52, Math.max(36, Math.floor(H * 0.22)));
  const trendH = H - VIC_BAND;
  const plotH = Math.max(24, trendH - 24);

  chartCtx.strokeStyle = "rgba(130,200,255,0.12)";
  chartCtx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i += 1) {
    const y = 4 + plotH * (i / 4);
    chartCtx.beginPath();
    chartCtx.moveTo(28, y);
    chartCtx.lineTo(W - 8, y);
    chartCtx.stroke();
  }
  chartCtx.fillStyle = "rgba(130,200,255,0.55)";
  chartCtx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  chartCtx.fillText("100%", 2, 9);
  chartCtx.fillText("50%", 4, 4 + plotH / 2);
  chartCtx.fillText("0%", 8, 4 + plotH + 3);

  if (survivalHistory.length >= 1) {
    const n = survivalHistory.length;
    const xAt = (i) => 28 + (W - 36) * (n === 1 ? 0 : i / (n - 1));
    const yAt = (pct) => 4 + plotH * (1 - pct);
    const baselineY = trendH - 12;

    chartCtx.beginPath();
    chartCtx.moveTo(xAt(0), baselineY);
    for (let i = 0; i < n; i += 1) chartCtx.lineTo(xAt(i), yAt(survivalHistory[i].alive));
    chartCtx.lineTo(xAt(n - 1), baselineY);
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
  }

  chartCtx.strokeStyle = "rgba(130,200,255,0.14)";
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(6, trendH - 2);
  chartCtx.lineTo(W - 6, trendH - 2);
  chartCtx.stroke();

  drawVictimSurvivalBars(chartCtx, W, H, trendH, VIC_BAND);

  chartCtx.fillStyle = "#5dffb4";
  chartCtx.font = "9px 'JetBrains Mono', 'Courier New', monospace";
  chartCtx.fillText("alive", W - 130, H - 4);
  chartCtx.fillStyle = "#82c8ff";
  chartCtx.fillText("rescued", W - 90, H - 4);
  chartCtx.fillStyle = "rgba(130,200,255,0.6)";
  chartCtx.fillText("HP", W - 46, H - 4);
}

function drawVictimSurvivalBars(ctx, W, H, trendH, vicBand) {
  const victims = state.victims;
  if (!victims.length) return;
  const top = trendH + 6;
  const barMaxH = Math.max(8, vicBand - 26);
  const n = victims.length;
  const barW = Math.max(2, Math.min(34, (W - 32) / (n + 1)));
  const gap = barW * 0.2;
  victims.forEach((v, i) => {
    // Use per-victim hp_max baseline — matches demo_player survival_pct semantics
    let pct = 0;
    if (v.status === "rescued") pct = 1;
    else if (v.status === "dead") pct = 0;
    else pct = clamp(v.survival_pct / 100, 0, 1);

    const barH = Math.max(2, barMaxH * pct);
    const x = 12 + i * (barW + gap) + gap;
    const y = top + barMaxH - barH;

    const color =
      v.status === "rescued"
        ? "#5dffb4"
        : v.status === "dead"
          ? "#555555"
          : (() => {
              const r = Math.round(255 * (1 - pct));
              const g = Math.round(200 * pct);
              return `rgb(${r},${g},0)`;
            })();

    ctx.fillStyle = color;
    ctx.shadowBlur = 5;
    ctx.shadowColor = color;
    ctx.fillRect(x, y, Math.max(1.5, barW - gap * 0.6), barH);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(130,200,255,0.5)";
    ctx.font = "8px 'JetBrains Mono', 'Courier New', monospace";
    ctx.fillText(v.id.replace(/^Victim-?/i, "").slice(0, 4) || v.id, x, top + barMaxH + 11);
  });
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

let speedMultiplier = 1;
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

function startAuto() {
  clearInterval(timer);
  lastCotFeedWallMs = performance.now() - COT_FEED_AUTO_MIN_MS;
  timer = setInterval(() => step(), simulationTickIntervalMs());
  setRunLabel("PAUSE");
}

stepBtn.addEventListener("click", () => { if (state) step(); });
resetBtn.addEventListener("click", () => { if (state) reset(); });
autoBtn.addEventListener("click", () => {
  if (timer) { stopAuto(); return; }
  startAuto();
});

document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") { e.preventDefault(); autoBtn.click(); }
  else if (e.key === ".") { e.preventDefault(); stepBtn.click(); }
  else if (e.key === "r" || e.key === "R") { e.preventDefault(); resetBtn.click(); }
});

/* ──────────────────────────────────────────────────────────────────────────
   3D first-person view
   ────────────────────────────────────────────────────────────────────────── */

function hash01(x, y, salt = 0) {
  return Math.abs(Math.sin((x + salt * 1.7) * 12.9898 + (y + salt * 0.7) * 78.233) * 43758.5) % 1;
}

function computeRoadCells(scenario) {
  const cells = new Set();
  const roads = scenario?.map?.roads || [];
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

function makeGradientSkyTexture(size = 512) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = size;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0.0, "#08101a");
  grad.addColorStop(0.45, "#1a1612");
  grad.addColorStop(0.72, "#3a2418");
  grad.addColorStop(0.88, "#5a3a22");
  grad.addColorStop(1.0, "#1c1610");
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addTerrainPatches3D(scenario) {
  const terrain = scenario?.map?.terrain || [];
  if (!terrain.length) return;
  const palettes = {
    grass: { color: 0x2d4a25, roughness: 0.95, metalness: 0.02, emissive: 0x000000 },
    water: { color: 0x1c3550, roughness: 0.2, metalness: 0.5, emissive: 0x031530 },
    rubble: { color: 0x3d3a35, roughness: 0.98, metalness: 0.02, emissive: 0x000000 },
    plaza: { color: 0x3a4250, roughness: 0.92, metalness: 0.05, emissive: 0x000000 }
  };

  for (const patch of terrain) {
    const [px, py, pw, ph] = patch.footprint;
    const palette = palettes[patch.kind] || palettes.plaza;
    const mat = new THREE.MeshStandardMaterial({
      color: palette.color,
      roughness: palette.roughness,
      metalness: palette.metalness,
      emissive: palette.emissive,
      emissiveIntensity: patch.kind === "water" ? 0.3 : 0
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

function buildHorizonSilhouette(scenario) {
  const [cols, rows] = scenario.map.size;
  const cx = cols / 2;
  const cz = rows / 2;
  const baseRadius = Math.max(cols, rows) * 1.85;
  const silMat = new THREE.MeshBasicMaterial({
    color: 0x0a0d13,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    fog: true
  });
  const count = 56;
  const instMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), silMat, count);
  const dummy = new THREE.Object3D();
  const lit = new THREE.Color(0x201813);
  const dark = new THREE.Color(0x070a0f);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const gap = hash01(i, 0, 97) < 0.24;
    const r = baseRadius + hash01(i, 0, 91) * 18;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    const w = 1.2 + hash01(i, 0, 92) * 2.1;
    const d = 1.2 + hash01(i, 0, 93) * 2.1;
    const h = gap ? 0.01 : 0.8 + hash01(i, 0, 94) * 3.6;
    dummy.position.set(x, h / 2, z);
    dummy.rotation.set(0, angle + Math.PI / 2 + (hash01(i, 0, 95) - 0.5) * 0.5, 0);
    dummy.scale.set(gap ? 0.01 : w, h, gap ? 0.01 : d);
    dummy.updateMatrix();
    instMesh.setMatrixAt(i, dummy.matrix);
    instMesh.setColorAt(i, hash01(i, 0, 96) > 0.9 ? lit : dark);
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = "horizon-silhouette";
  group.add(instMesh);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4 + 0.1) * Math.PI * 2;
    const r = baseRadius + 9;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    const phase = i * 1.5;
    for (let p = 0; p < 6; p += 1) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(2.2 + p * 0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x1e1a17, transparent: true, opacity: 0.25 - p * 0.025, depthWrite: false, fog: true })
      );
      sphere.position.set(x + Math.sin(phase + p) * 1.2, 6 + p * 2.5, z + Math.cos(phase + p) * 1.2);
      group.add(sphere);
    }
  }
  world.scene.add(group);
  world.horizonSilhouette = group;
}

function buildRoads3D(scenario) {
  const roads = scenario?.map?.roads || [];
  if (!roads.length) return;

  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.95, metalness: 0.05 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x586173, roughness: 0.85, metalness: 0.05 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffe44d, emissive: 0xffe44d, emissiveIntensity: 0.45, roughness: 0.6 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xd6dde4, emissive: 0xd6dde4, emissiveIntensity: 0.18, roughness: 0.7 });

  const group = new THREE.Group();
  group.name = "roads3d";

  for (const road of roads) {
    const isMain = road.kind === "main";
    const width = isMain ? 1.0 : 0.7;
    const pts = road.points || [];
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

function buildingProfile(kind) {
  const profiles = {
    apartment: { color: 0x677382, roof: 0x222a32, minH: 1.35, maxH: 2.6, floors: 5 },
    civic: { color: 0x7d786c, roof: 0x252a2e, minH: 1.1, maxH: 2.1, floors: 4 },
    warehouse: { color: 0x5c6470, roof: 0x30343a, minH: 0.75, maxH: 1.35, floors: 2 },
    lowrise: { color: 0x766b5f, roof: 0x2b2927, minH: 0.85, maxH: 1.55, floors: 3 }
  };
  return profiles[kind] || profiles.lowrise;
}

function nearestRiskKind(cellX, cellY, riskZones) {
  let best = { damage: 0, kind: null };
  for (const z of riskZones || []) {
    const dx = cellX - z.center[0];
    const dy = cellY - z.center[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    const reach = Math.max(0.01, z.radius + 1.5);
    if (d > reach) continue;
    const damage = Math.max(0, 1 - d / reach);
    if (damage > best.damage) best = { damage, kind: z.type };
  }
  return best;
}

function addBuildingWindows(group, footprint, height, damage, floors, windowMat) {
  if (damage > 0.72 || height < 0.55) return;
  const [x, y, w, d] = footprint;
  const usableFloors = Math.max(1, Math.min(floors, Math.floor(height / 0.28)));
  const colsX = Math.max(1, Math.min(5, Math.floor(w * 1.5)));
  const colsZ = Math.max(1, Math.min(5, Math.floor(d * 1.5)));
  const addPane = (px, py, pz, rotY, sx = 0.09) => {
    if (hash01(px * 3, pz * 3, Math.round(py * 10)) < damage * 0.45) return;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(sx, 0.075), windowMat);
    pane.position.set(px, py, pz);
    pane.rotation.y = rotY;
    group.add(pane);
  };

  for (let floor = 1; floor <= usableFloors; floor += 1) {
    const py = Math.min(height - 0.16, 0.22 + floor * (height / (usableFloors + 1)));
    for (let i = 0; i < colsX; i += 1) {
      const px = x + ((i + 1) / (colsX + 1)) * w;
      addPane(px, py, y - 0.006, 0);
      addPane(px, py, y + d + 0.006, Math.PI);
    }
    for (let i = 0; i < colsZ; i += 1) {
      const pz = y + ((i + 1) / (colsZ + 1)) * d;
      addPane(x - 0.006, py, pz, Math.PI / 2);
      addPane(x + w + 0.006, py, pz, -Math.PI / 2);
    }
  }
}

function addBuildingRubble(group, footprint, damage, rubbleMat) {
  if (damage < 0.28) return;
  const [x, y, w, d] = footprint;
  const count = Math.min(18, Math.max(4, Math.floor(w * d * (3 + damage * 3))));
  for (let i = 0; i < count; i += 1) {
    const sideBias = hash01(x + i, y, 170);
    const rx = x + hash01(x + i, y, 171) * w + (sideBias < 0.25 ? -0.18 : sideBias > 0.75 ? 0.18 : 0);
    const rz = y + hash01(x, y + i, 172) * d + (sideBias > 0.35 && sideBias < 0.6 ? -0.18 : sideBias > 0.6 && sideBias < 0.85 ? 0.18 : 0);
    const rw = 0.08 + hash01(rx, rz, 173) * 0.22;
    const rh = 0.04 + hash01(rx, rz, 174) * 0.14;
    const rd = 0.08 + hash01(rx, rz, 175) * 0.22;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rd), rubbleMat);
    chunk.position.set(rx, rh / 2 + 0.035, rz);
    chunk.rotation.set((hash01(rx, rz, 176) - 0.5) * 0.8, hash01(rx, rz, 177) * Math.PI * 2, (hash01(rx, rz, 178) - 0.5) * 0.8);
    group.add(chunk);
  }
}

function buildScenarioBuildings3D(scenario) {
  const buildings = scenario?.map?.buildings || [];
  if (!buildings.length) return;

  const group = new THREE.Group();
  group.name = "scenario-buildings";
  const riskZones = scenario.map.risk_zones || [];
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xa9d6e5, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
  const sootMat = new THREE.MeshBasicMaterial({ color: 0x050404, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x51483e, roughness: 0.98, metalness: 0.03 });
  const roofMatCache = new Map();
  const wallMatCache = new Map();

  const matFor = (key, color, damage, fire) => {
    const cacheKey = `${key}-${color}-${Math.round(damage * 10)}-${fire ? 1 : 0}`;
    const cache = key === "roof" ? roofMatCache : wallMatCache;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const c = new THREE.Color(color);
    c.multiplyScalar(fire ? 0.45 : damage > 0.55 ? 0.58 : damage > 0.25 ? 0.75 : 1);
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.92,
      metalness: 0.04,
      emissive: fire ? 0x1a0803 : 0x000000,
      emissiveIntensity: fire ? 0.25 : 0
    });
    cache.set(cacheKey, mat);
    return mat;
  };

  for (const b of buildings) {
    const [x, y, w, d] = b.footprint;
    if (w <= 0 || d <= 0) continue;
    const profile = buildingProfile(b.kind);
    const cx = x + w / 2;
    const cz = y + d / 2;
    const risk = nearestRiskKind(cx, cz, riskZones);
    const damage = risk.damage;
    const fire = risk.kind === "fire" && damage > 0.18;
    const collapsed = risk.kind === "collapse" && damage > 0.58;
    const heightSeed = hash01(x, y, 130);
    let height = profile.minH + heightSeed * (profile.maxH - profile.minH);
    if (collapsed) height *= 0.32 + hash01(x, y, 131) * 0.22;
    else if (damage > 0.35) height *= 0.72 + hash01(x, y, 132) * 0.16;

    const footprint = [x + 0.08, y + 0.08, Math.max(0.2, w - 0.16), Math.max(0.2, d - 0.16)];
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(footprint[2], height, footprint[3]),
      matFor("wall", profile.color, damage, fire)
    );
    shell.position.set(cx, height / 2 + 0.025, cz);
    if (damage > 0.32 && !collapsed) {
      shell.rotation.x = (hash01(x, y, 133) - 0.5) * damage * 0.18;
      shell.rotation.z = (hash01(x, y, 134) - 0.5) * damage * 0.18;
    }
    group.add(shell);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(footprint[2] * 1.02, 0.045, footprint[3] * 1.02),
      matFor("roof", profile.roof, damage, fire)
    );
    roof.position.set(cx, height + 0.055, cz);
    roof.rotation.copy(shell.rotation);
    group.add(roof);

    addBuildingWindows(group, footprint, height, damage, profile.floors, windowMat);
    addBuildingRubble(group, footprint, Math.max(damage, collapsed ? 0.8 : 0), rubbleMat);

    if (fire) {
      const soot = new THREE.Mesh(new THREE.PlaneGeometry(footprint[2] * 0.65, Math.max(0.35, height * 0.65)), sootMat);
      soot.position.set(cx, Math.max(0.25, height * 0.55), y + 0.07);
      soot.rotation.x = 0;
      group.add(soot);
    }
  }

  world.scene.add(group);
  world.scenarioBuildingsGroup = group;
}

function addFireSmoke(scenario) {
  const fireZones = (scenario?.map?.risk_zones || []).filter((z) => z.type === "fire");
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

    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8c30, transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    );
    ember.position.set(baseX, 0.25, baseZ);
    world.scene.add(ember);
    world.fireGlows.push({ ember, _isEmber: true, x: baseX, z: baseZ });

    const puffCount = 12;
    const plumeHeight = 14;
    for (let i = 0; i < puffCount; i += 1) {
      const phase = i / puffCount;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x1f1c19, transparent: true, opacity: 0.7, depthWrite: false, fog: true })
      );
      sphere.position.set(baseX, 0.6 + phase * plumeHeight, baseZ);
      world.scene.add(sphere);
      world.smokePuffs.push({ mesh: sphere, baseX, baseZ, baseY: 0.6, height: plumeHeight, phase, zoneId: z.id });
    }
  }
}

function updateSmokeAndGlows(t) {
  if (world.smokePuffs) {
    const ageNorm = (t * 0.045) % 1;
    for (const p of world.smokePuffs) {
      const localT = (p.phase + ageNorm) % 1;
      p.mesh.position.y = p.baseY + localT * p.height;
      p.mesh.scale.setScalar(0.65 + localT * 1.8);
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

function addStreetFurniture(scenario) {
  const [cols, rows] = scenario.map.size;
  const roadCells = computeRoadCells(scenario);
  const riskZones = scenario.map.risk_zones || [];
  const hLines = new Set();
  const vLines = new Set();

  for (const road of scenario.map.roads || []) {
    const pts = road.points || [];
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
          lamp.position.set(x + 0.5 + ox * 0.55, 0, y + 0.5 + oz * 0.55);
          if (damage > 0.45) {
            lamp.rotation.z = (hash01(x, y, 51 + ox + oz * 2) - 0.5) * 0.6;
            lamp.rotation.x = (hash01(x, y, 52 + ox + oz * 2) - 0.5) * 0.3;
          }
          world.scene.add(lamp);
        }
      }
    }
  }

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d4a25, roughness: 0.9 });
  const fallenLeafMat = new THREE.MeshStandardMaterial({ color: 0x4a3522, roughness: 0.95 });
  for (const patch of scenario.map.terrain || []) {
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
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 8), fallen ? fallenLeafMat : leafMat);
      leaves.position.y = 0.7;
      tree.add(leaves);
      tree.position.set(tx, 0, tz);
      tree.scale.setScalar(0.8 + hash01(tx, tz, 43) * 0.6);
      if (fallen) tree.rotation.z = (Math.PI / 2) * (hash01(tx, tz, 45) > 0.5 ? 1 : -1) * 0.85;
      world.scene.add(tree);
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
    hydrant.position.set(cx + 0.92, 0, cz + 0.92);
    world.scene.add(hydrant);
  }
}

function init3D(scenario) {
  if (world.initialized || povCols.length === 0) return;
  const [cols, rows] = scenario.map.size;

  // Build shared scene once
  world.scene = new THREE.Scene();
  world.scene.background = new THREE.Color(0x070d16);
  world.scene.fog = new THREE.FogExp2(0x080f1a, 0.016);

  // Ambient floor so shadow side of objects stays readable in the FPV cone.
  world.scene.add(new THREE.AmbientLight(0x6b88aa, 0.35));

  // Three-point rig: warm hemi from above, cool fill, soft rim
  const hemi = new THREE.HemisphereLight(0x5680c0, 0x0a0f1a, 1.0);
  world.scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0d8, 0.95);
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

  // Sky-dome — smoky disaster gradient for the FPV horizon
  const skyTex = makeGradientSkyTexture(512);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  world.scene.add(sky);

  // Scenario-driven world detail. These helpers are guarded so legacy
  // scenarios without terrain/roads still render the base FPV scene.
  buildHorizonSilhouette(scenario);
  addTerrainPatches3D(scenario);
  buildScenarioBuildings3D(scenario);

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

  buildRoads3D(scenario);
  addFireSmoke(scenario);
  addStreetFurniture(scenario);

  // Agents — detailed primitive build matching the marketing hero aesthetic
  for (const a of scenario.agents) {
    const grp = createAgentMesh(a.type);
    grp.position.set(a.location[0] + 0.5, agentBaseAltitude(a.type), a.location[1] + 0.5);
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
    renderer.toneMappingExposure = 1.4;

    const camera = new THREE.PerspectiveCamera(72, 16 / 10, 0.1, 200);
    camera.position.set(cols / 2, 1.5, rows / 2);
    camera.lookAt(cols / 2 + 1, 0.8, rows / 2);

    // Camera-mounted spotlight so the operator can see the immediate forward
    // surroundings of the active agent. Each POV gets its own light so multiple
    // viewports don't double-illuminate the same agent.
    const povSpot = new THREE.SpotLight(0xffd9a0, 1.6, 18, Math.PI / 4, 0.4, 1.0);
    povSpot.position.set(0, 0, 0);
    povSpot.target.position.set(0, 0, -6);
    camera.add(povSpot);
    camera.add(povSpot.target);
    world.scene.add(camera);

    const initialId = DEFAULT_POV_AGENTS[i] || scenario.agents[i]?.id || scenario.agents[0]?.id;
    const heading = col.querySelector("[data-pov-heading]");
    if (heading) heading.textContent = `FPV · ${initialId}`;

    const entry = {
      col,
      canvas,
      renderer,
      camera,
      povSpot,
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

function createBalloonMesh() {
  // Aerostat — translucent envelope, gondola, tethered comm relay halo
  const grp = new THREE.Group();

  const envelopeMat = new THREE.MeshStandardMaterial({
    color: 0xc8b4ff,
    emissive: 0xc8b4ff,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.78,
    roughness: 0.35,
    metalness: 0.05
  });
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 18), envelopeMat);
  envelope.scale.set(1, 1.2, 1);
  envelope.position.y = 0.15;
  grp.add(envelope);

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.32, 0.18, 14, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8c7bb0, roughness: 0.7 })
  );
  skirt.position.y = -0.42;
  grp.add(skirt);

  const gondola = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.18, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x3a3450, roughness: 0.7, metalness: 0.25 })
  );
  gondola.position.y = -0.6;
  grp.add(gondola);

  // Comm-relay halo (visible from other POVs)
  const haloLight = new THREE.PointLight(0xc8b4ff, 1.4, 10);
  haloLight.position.y = 0.1;
  grp.add(haloLight);

  // Beacon strip on the envelope
  const beacon = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.012, 6, 28),
    new THREE.MeshStandardMaterial({ color: 0xc8b4ff, emissive: 0xc8b4ff, emissiveIntensity: 1.6, toneMapped: false })
  );
  beacon.rotation.x = Math.PI / 2;
  beacon.position.y = 0.15;
  grp.add(beacon);

  // Tether (visible thin line trailing down)
  const tether = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 3.0, 6),
    new THREE.MeshBasicMaterial({ color: 0xc8b4ff, transparent: true, opacity: 0.45, fog: false })
  );
  tether.position.y = -2.1;
  grp.add(tether);

  grp.userData = { navLight: haloLight, beacon, statusRing: beacon };
  return grp;
}

function createArmoredMesh() {
  // Heavy armored ground rescuer — wide tracked chassis, sloped armor wedges,
  // amber light bar, six road wheels (visual; not driven by physics).
  const grp = new THREE.Group();
  const chassisColor = 0x6a3b18;
  const trimColor = 0x8a4a20;

  const chassisMat = new THREE.MeshStandardMaterial({ color: chassisColor, metalness: 0.55, roughness: 0.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.55, roughness: 0.45 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff8c3c, emissive: 0xff8c3c, emissiveIntensity: 1.4, toneMapped: false });

  // Lower hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 1.0), chassisMat);
  hull.position.y = 0.22;
  grp.add(hull);

  // Sloped front armor
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.26, 0.22), trimMat);
  front.position.set(0, 0.26, 0.58);
  front.rotation.x = -0.42;
  grp.add(front);

  // Sloped rear armor
  const rear = front.clone();
  rear.position.set(0, 0.26, -0.58);
  rear.rotation.x = 0.42;
  grp.add(rear);

  // Upper hull
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.7), trimMat);
  upper.position.set(0, 0.42, -0.05);
  grp.add(upper);

  // Sensor / remote-weapon-station mast
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.34), chassisMat);
  mast.position.set(0, 0.56, -0.05);
  grp.add(mast);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x05080a, metalness: 0.9, roughness: 0.08 })
  );
  lens.position.set(0, 0.56, 0.13);
  grp.add(lens);

  // Amber light bar (emissive, this is the beacon)
  const lightBar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.07), accentMat);
  lightBar.position.set(0, 0.65, -0.05);
  grp.add(lightBar);

  // Tracks
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x12100a, roughness: 0.92, metalness: 0.05 });
  for (const side of [-1, 1]) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 1.0), trackMat);
    tread.position.set(side * 0.42, 0.12, 0);
    grp.add(tread);
    // six road wheels per side (purely visual)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 6; i += 1) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.42, 0.07, -0.42 + i * 0.17);
      grp.add(wheel);
    }
  }

  // Headlights
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 1.6, toneMapped: false });
  const hlL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), hlMat);
  hlL.position.set(-0.28, 0.26, 0.7);
  grp.add(hlL);
  const hlR = hlL.clone();
  hlR.position.x = 0.28;
  grp.add(hlR);

  const spot = new THREE.SpotLight(0xffd9a0, 1.3, 8, Math.PI / 4.5, 0.5, 1.2);
  spot.position.set(0, 0.55, 0.55);
  spot.target.position.set(0, 0, 3);
  grp.add(spot);
  grp.add(spot.target);

  const navLight = new THREE.PointLight(0xff8c3c, 1.2, 5);
  navLight.position.y = 0.7;
  grp.add(navLight);

  grp.userData = { navLight, lightBar, beacon: lightBar };
  return grp;
}

function createAgentMesh(type) {
  if (type === "drone") return createDroneMesh();
  if (type === "balloon") return createBalloonMesh();
  if (type === "ground_armored") return createArmoredMesh();
  return createUgvMesh();
}

function agentBaseAltitude(type) {
  if (type === "drone") return 1.5;
  if (type === "balloon") return 3.6;
  return 0;
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

function agentIcon(type) {
  const wrap = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  if (type === "drone") {
    // Quadcopter — X frame, four rotors, sensor lens
    return wrap(`
      <circle cx="6" cy="6" r="2.6"/>
      <circle cx="18" cy="6" r="2.6"/>
      <circle cx="6" cy="18" r="2.6"/>
      <circle cx="18" cy="18" r="2.6"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
      <line x1="18" y1="6" x2="6" y2="18"/>
      <circle cx="12" cy="12" r="2.4" fill="currentColor"/>
    `);
  }

  if (type === "balloon") {
    // Aerostat — envelope, tether ropes, gondola, beacon
    return wrap(`
      <ellipse cx="12" cy="9" rx="5.5" ry="6"/>
      <path d="M12 9 m-5.5 0 a5.5 4 0 0 0 11 0" fill="currentColor" fill-opacity="0.18" stroke="none"/>
      <line x1="9" y1="14.5" x2="10.5" y2="17"/>
      <line x1="15" y1="14.5" x2="13.5" y2="17"/>
      <rect x="9.5" y="17" width="5" height="3" rx="0.5"/>
      <circle cx="12" cy="9" r="1.4" fill="currentColor"/>
    `);
  }

  if (type === "ground_rescue") {
    // Rescue UGV — chassis, tracks, medical cross
    return wrap(`
      <rect x="4" y="11" width="16" height="8" rx="1.5"/>
      <rect x="2.5" y="13" width="2" height="4" rx="0.6" fill="currentColor"/>
      <rect x="19.5" y="13" width="2" height="4" rx="0.6" fill="currentColor"/>
      <path d="M11 4 L13 4 L13 6 L15 6 L15 8 L13 8 L13 10 L11 10 L11 8 L9 8 L9 6 L11 6 Z" fill="currentColor" stroke="none"/>
    `);
  }

  if (type === "ground_clear") {
    // Clearer UGV — chassis with forward bulldozer blade
    return wrap(`
      <rect x="7" y="10" width="13" height="8" rx="1.2"/>
      <rect x="6" y="12" width="2" height="4" rx="0.6" fill="currentColor"/>
      <rect x="19.5" y="12" width="2" height="4" rx="0.6" fill="currentColor"/>
      <path d="M3 8 L3 20" stroke-width="2.4"/>
      <path d="M3 8 L7 11" />
      <path d="M3 20 L7 17" />
      <rect x="11" y="6" width="6" height="4" rx="0.6"/>
    `);
  }

  if (type === "ground_armored") {
    // Armored vehicle — sloped hexagonal hull, tracks, turret mast
    return wrap(`
      <path d="M3 13 L6 9 L18 9 L21 13 L21 17 L18 21 L6 21 L3 17 Z"/>
      <line x1="3" y1="13" x2="21" y2="13"/>
      <line x1="3" y1="17" x2="21" y2="17"/>
      <rect x="10" y="4" width="4" height="5" rx="0.5"/>
      <circle cx="12" cy="6.5" r="0.9" fill="currentColor"/>
      <circle cx="8" cy="15" r="0.9" fill="currentColor"/>
      <circle cx="16" cy="15" r="0.9" fill="currentColor"/>
    `);
  }

  // fallback — generic ground unit
  return wrap(`
    <rect x="4" y="9" width="16" height="9" rx="1.5"/>
    <rect x="2.5" y="11" width="2" height="5" rx="0.8" fill="currentColor"/>
    <rect x="19.5" y="11" width="2" height="5" rx="0.8" fill="currentColor"/>
    <circle cx="12" cy="13.5" r="1.4" fill="currentColor"/>
  `);
}

function buildAgentSelector(agents) {
  if (!agentSelectorHost) return;
  agentSelectorHost.innerHTML = "";
  agentCardEls.clear();
  agents.forEach((a, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "agent-card";
    card.dataset.agentId = a.id;
    card.dataset.kind = a.type;
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

  const fbxLoader = new FBXLoader();

  const [
    aptGlb, facadeGlb, mansionGlb, multiGlb,
    rubbleGlb, signsGlb, survivorGlb, taxiGlb,
    cBase, cNorm, cRough,
    bBase, bNorm, bRough,
    pBase, pNorm, pRough,
    dBase, dNorm, dRough,
    c2Base, c2Norm, c2Rough,
    rBase, rNorm, rRough,
    wBase, wNorm, wRough,
    mBase, mMetal, mNorm, mRough,
    heroFbx, heroColor, heroBumpNm
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
    texLoader.loadAsync(`${T}damage-a_roughness.jpg`),
    texLoader.loadAsync(`${T}concrete-b_basecolor.jpg`),
    texLoader.loadAsync(`${T}concrete-b_normal.jpg`),
    texLoader.loadAsync(`${T}concrete-b_roughness.jpg`),
    texLoader.loadAsync(`${T}rubble-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}rubble-a_normal.jpg`),
    texLoader.loadAsync(`${T}rubble-a_roughness.jpg`),
    texLoader.loadAsync(`${T}wood-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}wood-a_normal.jpg`),
    texLoader.loadAsync(`${T}wood-a_roughness.jpg`),
    texLoader.loadAsync(`${T}metal-rust_basecolor.jpg`),
    texLoader.loadAsync(`${T}metal-rust_metallic.jpg`),
    texLoader.loadAsync(`${T}metal-rust_normal.jpg`),
    texLoader.loadAsync(`${T}metal-rust_roughness.jpg`),
    fbxLoader.loadAsync("/models-fbx/AM165_001_VRay.fbx").catch((err) => { console.warn("[hero FBX] load failed:", err); return null; }),
    texLoader.loadAsync("/models-fbx/AM165_001_color.jpg").catch(() => null),
    texLoader.loadAsync("/models-fbx/AM165_001_bump_nm.jpg").catch(() => null)
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
  prepTexSet(c2Base, c2Norm, c2Rough);
  prepTexSet(rBase, rNorm, rRough);
  prepTexSet(wBase, wNorm, wRough);
  // Metal-rust set carries an extra metallic map; same wrap/repeat settings
  for (const tex of [mBase, mMetal, mNorm, mRough]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.anisotropy = 4;
  }
  mBase.colorSpace = THREE.SRGBColorSpace;

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
  const concreteBMat = makeMat(c2Base, c2Norm, c2Rough, 0x8c97a2);
  const rubbleMat = makeMat(rBase, rNorm, rRough, 0x7a6450);
  const woodMat = makeMat(wBase, wNorm, wRough, 0x8a6a44);
  const rustMat = new THREE.MeshStandardMaterial({
    map: mBase,
    normalMap: mNorm,
    roughnessMap: mRough,
    metalnessMap: mMetal,
    color: 0x6b554a,
    roughness: 0.6,
    metalness: 0.85
  });

  const buildingMats = [concreteMat, brickMat, plasterMat, damageMat, concreteBMat];

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
      if (obj.isMesh) obj.material = rubbleMat;
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
  scatterScenery(scenario, buildingTemplates, taxiGlb.scene, signsGlb.scene, rubbleGlb.scene, { rubbleMat, woodMat, rustMat });

  // Single hero landmark from the AM165 FBX at city center
  placeHeroProp(scenario, heroFbx, heroColor, heroBumpNm);

  // Texture the ground — use the second concrete variant so it reads distinct from building walls
  if (world.groundGrid) {
    const groundBase = c2Base.clone();
    const groundNorm = c2Norm.clone();
    const groundRough = c2Rough.clone();
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

function placeHeroProp(scenario, fbx, colorTex, bumpTex) {
  if (!fbx) return;
  if (colorTex) colorTex.colorSpace = THREE.SRGBColorSpace;
  fbx.traverse((obj) => {
    if (!obj.isMesh) return;
    const next = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.05
    });
    if (colorTex) next.map = colorTex;
    if (bumpTex) next.normalMap = bumpTex;
    obj.material = next;
  });
  fitToSize(fbx, 3.5);
  const [cols, rows] = scenario.map.size;
  fbx.position.set(cols / 2, groundedY(fbx), rows / 2);
  fbx.rotation.y = Math.PI / 4;
  world.scene.add(fbx);
  world.heroProp = fbx;
}

function scatterScenery(scenario, buildingTemplates, taxiSrc, signsSrc, rubbleSrc, palette = {}) {
  const { rubbleMat, woodMat, rustMat } = palette;
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
  for (const b of scenario.map.buildings || []) {
    const [bx, by, bw, bh] = b.footprint;
    for (let dx = 0; dx < bw; dx += 1) {
      for (let dy = 0; dy < bh; dy += 1) {
        mark(bx + dx, by + dy, 0);
      }
    }
  }
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
          // Burned/abandoned hulks get the rust material; ~40% chance
          if (rustMat && hash(x + 11, y - 1) < 0.4) {
            taxi.traverse((obj) => { if (obj.isMesh) obj.material = rustMat; });
          }
          world.scene.add(taxi);
        } else if (rr < 0.07 && signsSrc) {
          const sign = signsSrc.clone(true);
          fitToSize(sign, 0.5);
          sign.position.set(x + 0.5, groundedY(sign), y + 0.5);
          sign.rotation.y = cardinalRot(x + 2, y);
          // Weathered signs: ~30% rusted
          if (rustMat && hash(x + 13, y - 2) < 0.3) {
            sign.traverse((obj) => { if (obj.isMesh) obj.material = rustMat; });
          }
          world.scene.add(sign);
        }
        continue;
      }
      const r = hash(x, y);
      if (r < 0.32 && !(scenario.map.buildings || []).length) {
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
        if (rubbleMat) {
          debris.traverse((obj) => { if (obj.isMesh) obj.material = rubbleMat; });
        } else {
          debris.traverse((obj) => {
            if (obj.isMesh) {
              obj.material = obj.material.clone();
              if (obj.material.color) obj.material.color.setHex(0x554840);
              obj.material.roughness = 0.95;
            }
          });
        }
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

  if (woodMat) addWoodenScaffolding(scenario, woodMat);
}

function addWoodenScaffolding(scenario, woodMat) {
  const buildings = state?.tacticalBuildings;
  const hash = (x, y) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5) % 1;
  const placed = new Set();

  const placeScaffoldAt = (cx, cz, salt) => {
    const key = `${Math.round(cx * 4)},${Math.round(cz * 4)}`;
    if (placed.has(key)) return;
    placed.add(key);
    const scaffold = new THREE.Group();
    const postH = 1.5;
    const span = 0.45;
    for (const [ox, oz] of [[-span, -span], [span, -span], [span, span], [-span, span]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, postH, 0.05), woodMat);
      post.position.set(ox, postH / 2, oz);
      scaffold.add(post);
    }
    for (const yy of [postH * 0.35, postH * 0.7]) {
      const railA = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.05, 0.04, 0.04), woodMat);
      railA.position.set(0, yy, -span);
      scaffold.add(railA);
      const railB = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.05, 0.04, 0.04), woodMat);
      railB.position.set(0, yy, span);
      scaffold.add(railB);
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.05, 0.04, 0.04), woodMat);
    brace.position.set(0, postH * 0.5, -span);
    brace.rotation.z = Math.PI / 5;
    scaffold.add(brace);
    scaffold.position.set(cx, 0, cz);
    scaffold.rotation.y = hash(cx + salt, cz) * Math.PI * 2;
    world.scene.add(scaffold);
  };

  if (buildings && buildings.length) {
    const cellSize = scenario?.map?.cell_size_m ? 1 : 1;
    let count = 0;
    for (const b of buildings) {
      if (!(b.damage > 0.4)) continue;
      const cx = (b.centerX ?? b.x ?? 0) * cellSize;
      const cz = (b.centerY ?? b.y ?? 0) * cellSize;
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const offset = 0.7;
      const angle = hash(cx, cz) * Math.PI * 2;
      placeScaffoldAt(cx + Math.cos(angle) * offset, cz + Math.sin(angle) * offset, 1);
      count += 1;
      if (count >= 24) break;
    }
    if (count > 0) return;
  }

  const [cols, rows] = scenario.map.size;
  for (const z of (scenario.map.risk_zones || [])) {
    const samples = 4;
    for (let i = 0; i < samples; i += 1) {
      const a = (i / samples) * Math.PI * 2;
      const r = z.radius + 0.4;
      const cx = z.center[0] + 0.5 + Math.cos(a) * r;
      const cz = z.center[1] + 0.5 + Math.sin(a) * r;
      if (cx < 0.5 || cz < 0.5 || cx > cols - 0.5 || cz > rows - 0.5) continue;
      placeScaffoldAt(cx, cz, i * 3);
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
  updateSmokeAndGlows(t);

  for (const a of state.agents) {
    const mesh = world.agentMeshes.get(a.id);
    if (!mesh) continue;
    const prev = a.prevLocation || a.location;
    const ix = lerp(prev[0], a.location[0], frac);
    const iy = lerp(prev[1], a.location[1], frac);
    const phase = a.id.charCodeAt(0);
    let targetY;
    if (a.type === "drone") {
      targetY = 1.5 + Math.sin(t * 1.0 + phase) * 0.5 + Math.sin(t * 0.4 + phase * 0.5) * 0.25;
    } else if (a.type === "balloon") {
      // hovers high, very slow gentle drift
      targetY = 3.6 + Math.sin(t * 0.35 + phase) * 0.18 + Math.sin(t * 0.18 + phase * 0.5) * 0.12;
    } else {
      targetY = 0;
    }
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
    // Drones: base 1.5 + dual-sine vertical wander.
    // Balloons: base 3.6 — high-altitude observation.
    // Ground (UGV / armored): 0.45 — sensor turret height.
    let altitude;
    if (driver.type === "drone") {
      altitude = 1.5 + Math.sin(t * 1.0 + driver.id.charCodeAt(0)) * 0.5 + Math.sin(t * 0.4 + driver.id.charCodeAt(0) * 0.5) * 0.25;
    } else if (driver.type === "balloon") {
      altitude = 3.6 + Math.sin(t * 0.35 + driver.id.charCodeAt(0)) * 0.18;
    } else {
      altitude = 0.45;
    }
    const isAerial = driver.type === "drone" || driver.type === "balloon";
    const headBobX = isAerial ? Math.sin(t * 1.6 + phaseSeed) * 0.05 : 0;
    const headBobY = isAerial ? Math.sin(t * 2.2 + phaseSeed) * 0.04 : 0;
    const targetPos = new THREE.Vector3(ix + 0.5 + headBobX, altitude + headBobY, iy + 0.5);

    const target = currentTargetFor(driver);
    // Drones / balloons look strongly down at the ground (surveying for survivors).
    // Ground vehicles look slightly forward-down (mid-distance path scanning).
    const pitch = driver.type === "drone" ? -0.45 : driver.type === "balloon" ? -0.65 : -0.1;
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

/* ──────────────────────────────────────────────────────────────────────────
   Command-center extensions
   - Scenario synthesizer (preset + sliders → scenario JSON)
   - KPI counters, status bandwidth indicator
   - Speed buttons, config rail toggle, copy JSON, clear log
   - 3D world teardown so Apply & Reset can rebuild with new dimensions
   ────────────────────────────────────────────────────────────────────────── */

const PRESET_DEFAULTS = {
  urban_quake: {
    label: "MSN-001 · URBAN-QUAKE",
    phase: "CLOSED LOOP · GEMMA-4",
    grid: 30, victims: 5, blockades: 2, fires: 1, collapses: 1,
    intensity: 70, severity: 50, scout: 1, relay: 1, rescue: 1, clear: 1,
    balloons: 1, armored: 1,
    baseRange: 12, relayRange: 8, deadRadius: 4, dropout: 15
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

  // Risk zones — radii scaled by intensity so high-intensity earthquakes
  // produce zone-scale destruction across multiple blocks, not single tiles.
  const riskZones = [];
  const radiusBase = 3 + Math.round(cfg.intensity * 2.5); // 3..5+ cells
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

  // Comm dead zone — anchor on a risk zone if present, else a random cell
  const deadAnchor = riskZones.length ? riskZones[0].center : pickCell(6);
  const deadZones = cfg.deadRadius > 0 ? [{
    id: "C1",
    center: deadAnchor,
    radius: cfg.deadRadius,
    dropout_addition: Math.max(0.1, cfg.dropout * 2)
  }] : [];

  // Buildings — clone and tag against the freshly computed risk zones, so
  // blockade/victim placement below can lean on actual Firenze polygons.
  const synthBuildings = tacticalBuildingFootprints.map((b) => ({
    id: b.id,
    polygon: b.polygon,
    centroid: b.centroid,
    area: b.area,
    bounds: b.bounds,
    damage: "intact",
  }));
  tagBuildingDamage(synthBuildings, riskZones, cfg.cellSize || 10);
  const damagedPool = synthBuildings.filter((b) => b.damage !== "intact");

  // Road-snapped blockades: prefer cells where a road meets a damaged building.
  const blockades = [];
  const blockadeCandidates = damagedPool.length && tacticalRoadSegments.length
    ? buildBlockadeCandidatePool(damagedPool, tacticalRoadSegments, G)
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

  // Victims — HP system aligned with demo_player (timeline.json):
  //   hp_max ∈ [5000, 10000), damage_per_step ∈ [40, 100)
  //   survival_pct = hp / hp_max × 100  (individual baseline, not cross-victim)
  // Placement: prefer interiors of damaged/collapsed buildings when basemap is loaded.
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
  world.horizonSilhouette = null;
  world.scenarioBuildingsGroup = null;
  world.roadsGroup = null;
  world.smokePuffs = [];
  world.fireGlows = [];
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
  const phaseEl = $("msnPhase");
  if (phaseEl) phaseEl.textContent = preset.phase;
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
requestAnimationFrame(() => syncTacticalBasemapSize());

/* ──────────────────────────────────────────────────────────────────────────
   Onboarding tour
   - First visit (no localStorage flag): welcome modal then 8-step spotlight
   - Replay button (#tourReplay) launches the tour from step 1 any time
   ────────────────────────────────────────────────────────────────────────── */
const TOUR_KEY = "arc-sim-tour-v1";
const TOUR_STEPS = [
  {
    selector: ".cc-top-c",
    title: "Mission status",
    body: "Live T+ clock, rescued / total, agents online, survival rate. Watch SURVIVAL drop — that's your scoreboard."
  },
  {
    selector: ".vp-2d .canvas-frame",
    title: "Tactical map",
    body: "Top-down view of the disaster zone. Red pulse = victim. Yellow box = base. Orange = blockade. Translucent zones = fire / collapse."
  },
  {
    selector: ".vp-3d",
    title: "FPV feed",
    body: "First-person from the active agent. Press 1–4 to switch, or arrow keys to cycle."
  },
  {
    selector: ".cc-rail-r .rail-section:nth-of-type(1)",
    title: "Threat board",
    body: "Gemma-4 re-ranks every victim each tick by survival window × signal strength × access cost. The top of this list is your next move."
  },
  {
    selector: ".cc-rail-r .rail-section:nth-of-type(2)",
    title: "Fleet status",
    body: "Battery and current task per agent. Yellow text = actively assigned."
  },
  {
    selector: ".vp-brief",
    title: "Commander brief",
    body: "Plain-language explanation of why the planner chose what it chose."
  },
  {
    selector: "#cfgRail",
    title: "Scenario config",
    body: "Tune the disaster: presets, fleet counts, hazards, comms. Hit Apply & Reset to rebuild the scene."
  },
  {
    selector: ".cc-top-r .cc-controls",
    title: "Transport",
    body: "Space = play/pause, period = step, R = reset. Use the speed selector to scrub fast through long missions."
  }
];

const tourState = {
  index: 0,
  active: false,
  phase: null,
  resizeHandler: null,
  keyHandler: null
};

function setupTour() {
  const root = $("tourRoot");
  if (!root) return;

  // Phase A — welcome buttons
  root.querySelectorAll("[data-tour-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.tourAction;
      if (action === "start") startTourSteps();
      else if (action === "skip") endTour();
      else if (action === "next") tourNext();
      else if (action === "back") tourBack();
    });
  });

  // Replay button always available
  const replay = $("tourReplay");
  if (replay) replay.addEventListener("click", () => openTour());

  // Build progress dots
  const dotsEl = $("tourDots");
  if (dotsEl) {
    dotsEl.innerHTML = TOUR_STEPS.map(() => "<i></i>").join("");
  }
  const totalEl = $("tourStepTotal");
  if (totalEl) totalEl.textContent = String(TOUR_STEPS.length).padStart(2, "0");

  // First-visit auto-launch
  let seen = false;
  try { seen = window.localStorage.getItem(TOUR_KEY) === "done"; } catch {}
  if (!seen) {
    // Small delay so initial layout settles
    setTimeout(() => openTour({ welcome: true }), 350);
  }
}

function openTour({ welcome = true } = {}) {
  const root = $("tourRoot");
  if (!root) return;
  root.hidden = false;
  root.setAttribute("aria-hidden", "false");
  tourState.active = true;
  tourState.index = 0;

  const welcomeEl = root.querySelector('[data-tour-phase="welcome"]');
  const stepEl = root.querySelector('[data-tour-phase="step"]');
  if (welcome) {
    if (welcomeEl) welcomeEl.hidden = false;
    if (stepEl) stepEl.hidden = true;
    tourState.phase = "welcome";
  } else {
    if (welcomeEl) welcomeEl.hidden = true;
    startTourSteps();
  }

  if (!tourState.keyHandler) {
    tourState.keyHandler = (e) => {
      if (!tourState.active) return;
      if (e.key === "Escape") { e.preventDefault(); endTour(); }
      else if (tourState.phase === "step") {
        if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); tourNext(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); tourBack(); }
      } else if (tourState.phase === "welcome") {
        if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); startTourSteps(); }
      }
    };
    window.addEventListener("keydown", tourState.keyHandler, true);
  }
}

function startTourSteps() {
  const root = $("tourRoot");
  if (!root) return;
  const welcomeEl = root.querySelector('[data-tour-phase="welcome"]');
  const stepEl = root.querySelector('[data-tour-phase="step"]');
  if (welcomeEl) welcomeEl.hidden = true;
  if (stepEl) stepEl.hidden = false;
  tourState.phase = "step";
  tourState.index = 0;

  if (!tourState.resizeHandler) {
    tourState.resizeHandler = () => { if (tourState.active && tourState.phase === "step") renderTourStep(); };
    window.addEventListener("resize", tourState.resizeHandler);
  }
  renderTourStep();
}

function tourNext() {
  tourState.index += 1;
  if (tourState.index >= TOUR_STEPS.length) { endTour(); return; }
  renderTourStep();
}

function tourBack() {
  if (tourState.index <= 0) return;
  tourState.index -= 1;
  renderTourStep();
}

function endTour() {
  const root = $("tourRoot");
  if (!root) return;
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  tourState.active = false;
  tourState.phase = null;
  if (tourState.keyHandler) {
    window.removeEventListener("keydown", tourState.keyHandler, true);
    tourState.keyHandler = null;
  }
  if (tourState.resizeHandler) {
    window.removeEventListener("resize", tourState.resizeHandler);
    tourState.resizeHandler = null;
  }
  try { window.localStorage.setItem(TOUR_KEY, "done"); } catch {}
}

function renderTourStep() {
  const step = TOUR_STEPS[tourState.index];
  if (!step) return;

  // Resolve target element; if missing, skip to next
  const target = document.querySelector(step.selector);
  if (!target) {
    // Skip silently if the element isn't on this page (e.g. responsive collapse)
    tourState.index = Math.min(TOUR_STEPS.length - 1, tourState.index + 1);
    renderTourStep();
    return;
  }

  // Make sure the config rail is open if we're highlighting it
  if (step.selector === "#cfgRail") {
    const grid = $("ccGrid");
    if (grid && grid.classList.contains("cfg-collapsed")) grid.classList.remove("cfg-collapsed");
  }

  const rect = target.getBoundingClientRect();
  const pad = 8;
  const x = Math.max(4, rect.left - pad);
  const y = Math.max(4, rect.top - pad);
  const w = Math.min(window.innerWidth - x - 4, rect.width + pad * 2);
  const h = Math.min(window.innerHeight - y - 4, rect.height + pad * 2);

  // Update spotlight hole
  const hole = document.getElementById("tourHole");
  const stroke = document.getElementById("tourHoleStroke");
  if (hole) {
    hole.setAttribute("x", x); hole.setAttribute("y", y);
    hole.setAttribute("width", w); hole.setAttribute("height", h);
  }
  if (stroke) {
    stroke.setAttribute("x", x); stroke.setAttribute("y", y);
    stroke.setAttribute("width", w); stroke.setAttribute("height", h);
  }

  // Update caption content + position
  const caption = $("tourCaption");
  const numEl = $("tourStepNum");
  const titleEl = $("tourStepTitle");
  const bodyEl = $("tourStepBody");
  const dots = $("tourDots");
  if (numEl) numEl.textContent = String(tourState.index + 1).padStart(2, "0");
  if (titleEl) titleEl.textContent = step.title;
  if (bodyEl) bodyEl.textContent = step.body;
  if (dots) {
    [...dots.children].forEach((dot, i) => {
      dot.classList.toggle("done", i < tourState.index);
      dot.classList.toggle("current", i === tourState.index);
    });
  }

  if (caption) {
    caption.classList.add("entering");
    requestAnimationFrame(() => {
      // Position caption to the right of the spotlight, or left if no room
      const captionW = 380;
      const captionH = caption.offsetHeight || 220;
      const margin = 18;
      let cx = x + w + margin;
      if (cx + captionW > window.innerWidth - 8) cx = Math.max(8, x - captionW - margin);
      if (cx < 8) cx = Math.max(8, (window.innerWidth - captionW) / 2);
      let cy = y + (h - captionH) / 2;
      cy = Math.max(8, Math.min(window.innerHeight - captionH - 8, cy));
      caption.style.left = `${cx}px`;
      caption.style.top = `${cy}px`;
      requestAnimationFrame(() => caption.classList.remove("entering"));
    });
  }

  // Disable Back on first step, change Next → Finish on last
  const backBtn = document.querySelector('[data-tour-action="back"]');
  const nextBtn = document.querySelector('[data-tour-action="next"]');
  if (backBtn) backBtn.disabled = tourState.index === 0;
  if (nextBtn) nextBtn.textContent = tourState.index === TOUR_STEPS.length - 1 ? "Finish ✓" : "Next →";
}

