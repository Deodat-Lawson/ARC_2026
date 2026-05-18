import { rankVictims } from "../sim/plan.js";
import { currentScenePreset } from "../config/presets.js";
import { povs } from "../render/world3d/index.js";
import { simBridge } from "../sim/bridge.js";
import { emitToast, logEvent } from "../ui/toast.js";
import { PRESET_DEFAULTS, readConfig } from "../config/presets.js";
import {
  MS_PER_TICK,
  GEMMA_MS_PER_TICK,
  COT_FEED_MAX_BLOCKS,
} from "../sim/timing.js";

/** Thinking / brief DOM — set from app via {@link bindAiDom}. */
export const aiDom = {
  thinkingFeedEl: null,
  briefText: null,
};

export function bindAiDom(partial) {
  Object.assign(aiDom, partial);
}

export const FLEET_DIALOGUE_COT_BUILTIN = {
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
  scenes: {
    urban_quake: {
      dialogue: {
        orchestrator: {
          heartbeatFused: "${padT}: Gemma 4 fused collapse geometry, blocked corridors, and weak life-signal channels.",
          leadVictim: "Lead ${id}: survival ${survivalPct}% (${survivalSteps}t), comm ${comm}; structural-entry candidate ${bestAgent}.",
          policy: "Policy: bind ${taskCount} tasks with collapse-risk gating and drone confirmation before ground ingress.",
        },
        agentSlide: {
          riskNote: "Structural risk note: ${note}",
          radioDroneOut: "${agent} → ${radioTo}: confirming ${target}; checking facade shadows, dust occlusion, and thermal/audio consistency.",
          radioUgvOut: "${agent} → ${radioTo}: moving by routed corridor toward ${target}; reject cells intersecting collapse or rubble footprint.",
        },
        trafficNote: {
          lineBlock: "${blockId} constrains the rescue corridor; Gemma 4 keeps ground units off unstable debris until cleared.",
          lineRecommend: "Recommend drone cross-check of the corridor before committing the next extraction leg.",
        },
      },
      decisionHub: {
        summary: "Gemma 4 Decision Hub: collapse map, victim stack, and corridor status fused for ${sceneLabel}.",
        priority: "Priority: ${topId} leads at ${topScore}; signal fusion favors ${bestAgent} with comms ${comm}.",
        route: "Route feasibility: ${blockedCount} blocked corridor(s), ${rescueCount} rescue edge(s), collapse gates remain active.",
        task: "${agent}: ${taskHuman} ${target}; structural safety gate retained.",
        gate: "Commander gate: ${gate}",
        event: "Status event: ${lostCount} lost, ${rescued}/${totalVictims} extracted; keep drone confirmation ahead of UGV entry.",
        idle: "No active rescue edge; maintain acoustic/thermal sweep and preserve battery.",
      },
      commanderBrief: {
        active: "Gemma 4 fused signal confidence, collapse exposure, and corridor access. ${topId} is the lead objective; ${rescueAgent} should execute the safest ground approach while ${scoutAgent} verifies structural shadows. ${relaySentence}${blockadeSentence}",
        allClear: "All known urban quake / hurricane victims are resolved. Keep drones scanning secondary voids and hold ground teams outside unstable collapse cells.",
        relay: "Relay coverage is required before close approach. ",
        noRelay: "Relay coverage is adequate for the next move. ",
        blockade: "${blockId} still limits the corridor; clear it only if it blocks the active extraction. ",
        noBlockade: "Primary corridors are open enough for immediate extraction. ",
      },
    },
    wildfire: {
      dialogue: {
        orchestrator: {
          heartbeatFused: "${padT}: Gemma 4 fused fireline geometry, smoke/thermal ambiguity, relay coverage, and survivor urgency.",
          leadVictim: "Lead ${id}: survival ${survivalPct}% (${survivalSteps}t), comm ${comm}; fire-edge mover ${bestAgent}.",
          policy: "Policy: emit ${taskCount} tasks with thermal false-positive checks and smoke-safe relay geometry.",
        },
        agentSlide: {
          riskNote: "Wildfire risk note: ${note}",
          radioDroneOut: "${agent} → ${radioTo}: eyes on ${target}; separating survivor heat from flame reflections and smoke shimmer.",
          radioUgvOut: "${agent} → ${radioTo}: advancing around burn perimeter toward ${target}; request fresh wind/fireline picture each leg.",
        },
        trafficNote: {
          lineBlock: "${blockId} blocks the ground edge of the fire perimeter; convoy risk rises until bypass or clearance.",
          lineRecommend: "Recommend relay hold outside the smoke dropout zone before the next ground push.",
        },
      },
      decisionHub: {
        summary: "Gemma 4 Decision Hub: fireline, smoke dropout, and thermal confidence fused for ${sceneLabel}.",
        priority: "Priority: ${topId} leads at ${topScore}; thermal ambiguity checked against comms ${comm}.",
        route: "Route feasibility: ${blockedCount} blocked cell(s), burn perimeter avoidance active, relay demand ${relayNeed}.",
        task: "${agent}: ${taskHuman} ${target}; maintain smoke-safe offset.",
        gate: "Commander gate: ${gate}",
        event: "Status event: ${lostCount} lost, ${rescued}/${totalVictims} extracted; avoid treating flame reflections as survivor contact.",
        idle: "No active rescue edge; continue perimeter scan and battery-balanced loiter.",
      },
      commanderBrief: {
        active: "Gemma 4 fused fireline position, thermal ambiguity, and relay coverage. ${topId} is the lead objective; ${scoutAgent} should verify heat signature quality while ${rescueAgent} follows the burn-safe corridor. ${relaySentence}${blockadeSentence}",
        allClear: "All known wildfire contacts are resolved. Hold relay coverage and keep drones watching for new ember-spot detections.",
        relay: "Relay must hold outside the smoke dropout zone. ",
        noRelay: "Relay coverage is stable for the next move. ",
        blockade: "${blockId} constrains the ground edge; clear or bypass only if it blocks the active rescue. ",
        noBlockade: "Ground corridors are open enough around the active fire edge. ",
      },
    },
    industrial: {
      dialogue: {
        orchestrator: {
          heartbeatFused: "${padT}: Gemma 4 fused GLB facility occlusion, low-clearance obstacles, route cells, and casualty urgency.",
          leadVictim: "Lead ${id}: survival ${survivalPct}% (${survivalSteps}t), comm ${comm}; reachable contact candidate ${bestAgent}.",
          policy: "Policy: bind ${taskCount} tasks after checking facility passability and hazardous equipment zones.",
        },
        agentSlide: {
          riskNote: "Industrial risk note: ${note}",
          radioDroneOut: "${agent} → ${radioTo}: confirming ${target}; checking platform occlusion and reachable contact cell.",
          radioUgvOut: "${agent} → ${radioTo}: advancing through low-clearance passable lane toward ${target}; rejecting solid equipment footprints.",
        },
        trafficNote: {
          lineBlock: "${blockId} blocks a service lane; Gemma 4 distinguishes solid equipment from overhead structure.",
          lineRecommend: "Recommend rerouting only around low-level obstacles; overhead platforms are pass-through if vehicle envelope clears.",
        },
      },
      decisionHub: {
        summary: "Gemma 4 Decision Hub: GLB occlusion, vehicle envelope, and facility route cells fused for ${sceneLabel}.",
        priority: "Priority: ${topId} leads at ${topScore}; reachable-contact logic assigns ${bestAgent}.",
        route: "Route feasibility: ${blockedCount} service blockage(s), low-clearance obstacle filter active, contact-cell validation enabled.",
        task: "${agent}: ${taskHuman} ${target}; use solid-footprint avoidance, not overhead platform avoidance.",
        gate: "Commander gate: ${gate}",
        event: "Status event: ${lostCount} lost, ${rescued}/${totalVictims} extracted; victims are constrained to passable facility cells.",
        idle: "No active rescue edge; hold UGVs in service lanes and continue facility scan.",
      },
      commanderBrief: {
        active: "Gemma 4 fused facility occlusion, low-clearance obstacle geometry, and reachable contact points. ${topId} is the lead objective; ${rescueAgent} should use the passable service lane while ${scoutAgent} verifies platform occlusion. ${relaySentence}${blockadeSentence}",
        allClear: "All known industrial contacts are resolved. Keep UGVs in service lanes and monitor hazardous equipment zones.",
        relay: "Relay coverage is required across the facility shadow. ",
        noRelay: "Relay coverage is sufficient inside the facility. ",
        blockade: "${blockId} still blocks a service lane; clear it only if it gates the active contact point. ",
        noBlockade: "Low-clearance routing reports a reachable contact lane. ",
      },
    },
  },
};

/** Resolved from JSON fetch when available; defaults to builtin (mirrors `fleet-dialogue-cot.json`). */
export let fleetDialogueCot = FLEET_DIALOGUE_COT_BUILTIN;

export function applyFetchedFleetDialogueCot(json) {
  fleetDialogueCot = json && typeof json.version === "number" ? json : FLEET_DIALOGUE_COT_BUILTIN;
}

export function interpolate(template, vars = {}) {
  if (template == null) return "";
  return String(template).replace(/\$\{(\w+)\}/g, (_, key) =>
    (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ""));
}

export function cotFeedMaxBlocks() {
  return fleetDialogueCot?.feedMaxBlocks ?? COT_FEED_MAX_BLOCKS;
}

export function cotFeedSlideMax() {
  return fleetDialogueCot?.feedSlideMax ?? 6;
}

function mergeTemplateSection(base = {}, override = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeTemplateSection(base?.[key] || {}, value)
        : value;
  }
  return out;
}

export function activeSceneMock() {
  const scenes = fleetDialogueCot?.scenes ?? FLEET_DIALOGUE_COT_BUILTIN.scenes ?? {};
  return scenes[currentScenePreset] || scenes.urban_quake || {};
}

function activeDialogueTemplates() {
  return mergeTemplateSection(
    fleetDialogueCot?.dialogue ?? FLEET_DIALOGUE_COT_BUILTIN.dialogue,
    activeSceneMock().dialogue || {},
  );
}

function actionHuman(task) {
  return String(task || "task").replace(/_/g, " ");
}

function sceneLabelForPreset() {
  const labels = {
    urban_quake: "urban quake / hurricane",
    wildfire: "wildfire WUI",
    industrial: "industrial collapse",
  };
  return labels[currentScenePreset] || currentScenePreset || "mission";
}

function firstActionMatching(plan, predicate) {
  return (plan?.mission_plan || []).find(predicate) || null;
}

function sceneVars(plan) {
  const state = simBridge.state;
  const candidates = state ? rankVictims(state) : [];
  const top = candidates[0] || null;
  const firstRescue = firstActionMatching(plan, (a) => a.task === "ground_rescue");
  const firstScout = firstActionMatching(plan, (a) => a.task === "aerial_confirmation");
  const firstRelay = firstActionMatching(plan, (a) => a.task === "deploy_relay" || a.task === "deploy_balloon");
  const sacrifice = firstActionMatching(plan, (a) => a.task === "sacrificial_relay");
  const activeBlock = state?.map?.blocked_cells?.find((b) => b.status === "blocked") || null;
  const totalVictims = state?.victims?.length || 0;
  const rescued = state?.rescued ?? 0;
  const lostCount = state?.victims?.filter((v) => v.status === "dead").length || 0;
  return {
    sceneLabel: sceneLabelForPreset(),
    topId: top?.id || "no active victim",
    topScore: top?.score != null ? top.score.toFixed(2) : "—",
    bestAgent: top?.best_agent || firstRescue?.agent || "ground team",
    comm: top?.communication_status || "unknown",
    mortalityFactors: top?.mortality_factors || "mortality factors unavailable",
    mortalityRisk: top?.mortality_risk_label || "unknown",
    rescueAgent: firstRescue?.agent || top?.best_agent || "ground team",
    scoutAgent: firstScout?.agent || "Drone-1",
    relayNeed: firstRelay ? "required" : "not required",
    sacrificeAgent: sacrifice?.agent || "none",
    sacrificeTarget: sacrifice?.target || "none",
    sacrificeSentence: sacrifice
      ? `Decision hub authorized drone sacrifice: ${sacrifice.agent} will burn down as an industrial relay. `
      : "",
    blockId: activeBlock?.id || "no blockade",
    blockadeSentence: "",
    relaySentence: "",
    blockedCount: state?.map?.blocked_cells?.filter((b) => b.status === "blocked").length || 0,
    rescueCount: (plan?.mission_plan || []).filter((a) => a.task === "ground_rescue").length,
    lostCount,
    rescued,
    totalVictims,
  };
}

function renderSceneTemplate(template, plan, extra = {}) {
  return interpolate(template, { ...sceneVars(plan), ...extra });
}

/** Apply panel chrome from `fleet-dialogue-cot.json` (kicker, title, buttons, meta). */
export function applyFleetDialogueCotDom() {
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

let thinkingTimer = null;
let thinkingQueue = [];
let thinkingTyping = false;
const thinkingSeen = new Set();
const briefingSeen = new Set();

/* ------------------------------------------------------------------------- */
/* Live Gemma 4 · LiteRT (via /api/gemma-chat)                                */
/* ------------------------------------------------------------------------- */
export const AI_ENDPOINT = "/api/gemma-chat";
export const LIVE_AI_STORAGE_KEY = "arc_sim_ai_mode";

export function readInitialLiveAiMode() {
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
export let liveAiModeEnabled = readInitialLiveAiMode();

export function persistLiveAiMode() {
  try {
    localStorage.setItem(LIVE_AI_STORAGE_KEY, liveAiModeEnabled ? "gemma" : "mock");
  } catch { /* ignore */ }
}

export function syncAiModeSegmentedUi() {
  const mockBtn = document.getElementById("aiModeMock");
  const gemmaBtn = document.getElementById("aiModeGemma");
  if (!mockBtn || !gemmaBtn) return;
  mockBtn.classList.toggle("active", !liveAiModeEnabled);
  gemmaBtn.classList.toggle("active", liveAiModeEnabled);
  mockBtn.setAttribute("aria-pressed", (!liveAiModeEnabled).toString());
  gemmaBtn.setAttribute("aria-pressed", liveAiModeEnabled.toString());
  const preset = PRESET_DEFAULTS[readConfig().preset];
  syncTopBarAiUi(preset?.phase);
}

/** Header phase text: GEMMA-4 closed-loop vs rule-based MOCK. */
export function phaseLabelForBar(presetPhase) {
  if (!presetPhase) {
    return liveAiModeEnabled ? "CLOSED LOOP · GEMMA-4" : "SIMULATION · RULE-BASED";
  }
  if (!liveAiModeEnabled) {
    return presetPhase.replace(/\s*·\s*GEMMA-4\s*$/i, " · RULE-BASED");
  }
  return presetPhase;
}

/** Sync mission phase pill, hide Gemma chrome in MOCK, tighten top bar layout classes. */
export function syncTopBarAiUi(presetPhase) {
  const phaseEl = document.getElementById("msnPhase");
  if (phaseEl) phaseEl.textContent = phaseLabelForBar(presetPhase);

  const mock = !liveAiModeEnabled;
  const topBar = document.querySelector(".cc-top");
  const mainCc = document.querySelector("main.cc");
  topBar?.classList.toggle("cc-top--mock", mock);
  topBar?.classList.toggle("cc-top--gemma", !mock);
  mainCc?.classList.toggle("cc-ai-mock", mock);

  const msnState = document.getElementById("msnState");
  if (msnState) {
    msnState.classList.toggle("msn-state--mock", mock);
    const pulse = msnState.querySelector(".pulse");
    if (pulse) pulse.hidden = mock;
  }
}

export function applyLiveAiModeFromUser(enableGemma) {
  if (liveAiModeEnabled === enableGemma) return;
  liveAiModeEnabled = enableGemma;
  persistLiveAiMode();
  resetLiveAiState();
  if (!liveAiModeEnabled) {
    setAiStatusBadge(false);
  } else {
    liveAiConnected = null;
    setAiStatusBadge(null);
    void probeGemmaBackend();
  }
  const st = simBridge.state;
  const pl = simBridge.plan;
  if (st && pl) {
    simBridge.hooks?.renderOnce?.();
    if (liveAiModeEnabled) scheduleLiveAiRound(pl);
  }
  if (simBridge.hooks?.getTimer?.()) simBridge.hooks?.startAuto?.();
  syncAiModeSegmentedUi();
}

const agentHistories = {
  Drone_Alpha: [],
  Track_Beta: [],
  Relay_Gamma: [],
  Orchestrator: [],
};

export const liveAiCache = {
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

export let liveAiRequestId = 0;
export let liveAiInFlight = false;
/** @type {boolean|null} null = probing, true = Gemma / LiteRT backend reachable */
export let liveAiConnected = null;
/** Latest plan to run after the current Gemma round finishes (simulation keeps stepping). */
export let liveAiPendingPlan = null;
export let liveAiRoundStartedAt = 0;
export const GEMMA_ROUND_TIMEOUT_MS = 180_000;

export function simulationTickIntervalMs() {
  const base = liveAiModeEnabled ? GEMMA_MS_PER_TICK : MS_PER_TICK;
  const sm = simBridge.hooks?.getSpeedMultiplier?.() ?? 1;
  return Math.max(80, base / sm);
}

export function releaseStuckLiveAiRound() {
  if (!liveAiInFlight) return false;
  if (performance.now() - liveAiRoundStartedAt < GEMMA_ROUND_TIMEOUT_MS) return false;
  liveAiRequestId += 1;
  liveAiInFlight = false;
  liveAiCache.orchestratorLive = false;
  emitToast("default", "Gemma 4 round timed out — simulation continues");
  return true;
}

/** GEMMA4: queue inference; never block simulation timestep (D — serial rounds, no MOCK). */
export function scheduleLiveAiRound(plan) {
  if (!liveAiModeEnabled || !simBridge.state || !plan) return;
  if (liveAiConnected === false) return;
  releaseStuckLiveAiRound();
  if (liveAiInFlight) {
    liveAiPendingPlan = plan;
    syncLiveAiHudPending();
    return;
  }
  void triggerLiveAiRound(plan);
}

export function setAiStatusBadge(live) {
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

export function capturePoV() {
  const povCanvas =
    povs[0]?.canvas ||
    document.querySelector(".map-pov-col [data-pov-canvas]") ||
    document.querySelector("[data-pov-canvas]");
  if (!povCanvas || typeof povCanvas.toDataURL !== "function") return null;
  try {
    return povCanvas.toDataURL("image/jpeg", 0.5);
  } catch {
    return null;
  }
}

export function buildSimulationContext(plan) {
  const state = simBridge.state;
  if (!state || !plan) return "Simulation standby.";
  const candidates = rankVictims(state);
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

export function pushAgentHistory(agent, role, content) {
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
  const el = aiDom.thinkingFeedEl;
  if (!el) return "";

  liveAiCache.orchestratorLive = true;

  const row = document.createElement("div");
  row.className = "thinking-row thinking-row-live";
  const label = document.createElement("span");
  label.className = "thinking-step";
  label.textContent = `[T${String(simBridge.state?.timestep ?? 0).padStart(3, "0")}] `;
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
    liveAiCache.orchestratorTick = simBridge.state.timestep;
    pushAgentHistory("Orchestrator", "user", message);
    pushAgentHistory("Orchestrator", "assistant", text);
    thinkingSeen.add(text);
  }

  while (el.children.length > 80) el.removeChild(el.firstChild);
  syncLiveAiHudPending();
  return text;
}

export function buildLiveFleetSlides(orchestrator, drone, beta, gamma, plan) {
  const padT = `T+${String(simBridge.state?.timestep ?? 0).padStart(3, "0")}`;
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

export function applyLiveFleetSlides(plan, slides) {
  liveAiCache.fleetSlides = slides;
  liveAiCache.tick = simBridge.state?.timestep ?? -1;
  simBridge.hooks?.applyLiveFleetSlidesToDom?.(plan, slides);
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
    liveAiCache.briefingTick = simBridge.state.timestep;
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

export async function probeGemmaBackend() {
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
  if (!liveAiModeEnabled || !simBridge.state || !plan) return;
  if (liveAiConnected === false) return;

  if (liveAiConnected === null) {
    const up = await probeGemmaBackend();
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
    logEvent("relay_deployed", `Gemma 4 fleet round · T${String(simBridge.state?.timestep ?? 0).padStart(3, "0")}`);
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

export function resetLiveAiState() {
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

export function splitThinkingLog(text) {
  return String(text || "")
    .split(/(?<=[。！？.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function appendThinkingEntry(el, step, text, animate = true) {
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

export function playThinkingQueue(el) {
  if (thinkingTyping || !thinkingQueue.length) return;
  const next = thinkingQueue.shift();
  appendThinkingEntry(el, next.step, next.text, next.animate);
}

export function queueThinkingLog(el, step, text, animate = true) {
  splitThinkingLog(text).forEach((line) => {
    thinkingQueue.push({ step, text: line, animate });
  });
  playThinkingQueue(el);
}

export function appendBriefingRow(el, step, text) {
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

export function buildThinkingNarrative(plan) {
  if (!plan || !simBridge.state) return "Standing by — no planner output yet.";
  const state = simBridge.state;
  const candidates = rankVictims(state);
  const scene = activeSceneMock();
  const dh = scene.decisionHub;
  if (dh) {
    const parts = [];
    parts.push(renderSceneTemplate(dh.summary, plan));
    parts.push(renderSceneTemplate(dh.priority, plan));
    parts.push(renderSceneTemplate(dh.route, plan));
    const actions = plan.mission_plan || [];
    for (const action of actions.slice(0, 5)) {
      parts.push(renderSceneTemplate(dh.task, plan, {
        agent: action.agent,
        taskHuman: actionHuman(action.task),
        target: action.target,
      }));
    }
    if (candidates[0]) {
      parts.push(`Mortality model: ${candidates[0].mortality_risk_label} risk from ${candidates[0].mortality_factors}.`);
    }
    const sacrifice = firstActionMatching(plan, (a) => a.task === "sacrificial_relay");
    if (sacrifice) {
      parts.push(`Decision hub authorized drone sacrifice: ${sacrifice.agent} will be depleted for ${sacrifice.target}.`);
    }
    for (const line of plan.human_confirmation_required || []) {
      if (line && !/^no\s/i.test(line)) {
        parts.push(renderSceneTemplate(dh.gate, plan, { gate: line }));
      }
    }
    parts.push(renderSceneTemplate(dh.event, plan));
    if (!actions.length && dh.idle) parts.push(renderSceneTemplate(dh.idle, plan));
    return parts.filter(Boolean).join(" ");
  }
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

export function syncThinkingFeed(plan) {
  const el = aiDom.thinkingFeedEl;
  if (!el || !plan) return;
  const state = simBridge.state;
  if (!state) return;
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

export function syncBriefingFeed(plan) {
  const briefText = aiDom.briefText;
  if (!briefText || !plan) return;
  const state = simBridge.state;
  if (!state) return;
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
  const text = buildMockCommanderBrief(plan) || plan.commander_briefing;
  if (!text) return;
  if (briefingSeen.has(text)) return;
  briefingSeen.add(text);
  appendBriefingRow(briefText, state.timestep, text);
}

export function buildMockCommanderBrief(plan) {
  const state = simBridge.state;
  if (!state || !plan) return "";
  const cb = activeSceneMock().commanderBrief;
  if (!cb) return "";
  const candidates = rankVictims(state);
  if (!candidates.length) return renderSceneTemplate(cb.allClear, plan);

  const firstRelay = firstActionMatching(plan, (a) => a.task === "deploy_relay" || a.task === "deploy_balloon");
  const sacrifice = firstActionMatching(plan, (a) => a.task === "sacrificial_relay");
  const activeBlock = state.map?.blocked_cells?.find((b) => b.status === "blocked");
  const relaySentence = renderSceneTemplate(firstRelay ? cb.relay : cb.noRelay, plan);
  const blockadeSentence = renderSceneTemplate(activeBlock ? cb.blockade : cb.noBlockade, plan, {
    blockId: activeBlock?.id || "no blockade",
  });
  const mortalitySentence = `${candidates[0].mortality_risk_label} mortality model: ${candidates[0].mortality_factors}. `;
  const sacrificeSentence = sacrifice
    ? `Decision hub authorized drone sacrifice: ${sacrifice.agent} will deplete as a relay for ${sacrifice.target}. `
    : "";
  return renderSceneTemplate(cb.active, plan, { relaySentence, blockadeSentence, mortalitySentence, sacrificeSentence });
}

/** UI-only placeholders while waiting for real Gemma output (not MOCK decision text). */
export function syncLiveAiHudPending() {
  const briefId = "briefAiPending";
  const thinkId = "thinkAiPending";
  let bp = document.getElementById(briefId);
  let tp = document.getElementById(thinkId);
  const state = simBridge.state;

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

  const briefText = aiDom.briefText;
  const thinkingFeedEl = aiDom.thinkingFeedEl;

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

export function resetDecisionFeeds() {
  clearInterval(thinkingTimer);
  thinkingTimer = null;
  thinkingQueue.length = 0;
  thinkingTyping = false;
  thinkingSeen.clear();
  briefingSeen.clear();
  resetLiveAiState();
  if (aiDom.thinkingFeedEl) aiDom.thinkingFeedEl.innerHTML = "";
  if (aiDom.briefText) aiDom.briefText.innerHTML = "";
}

export function agentDialogueClass(agent) {
  if (!agent) return "mesh";
  return agent.type === "drone" ? "drone" : "ugv";
}

export function pickDialoguePeer(action, agents) {
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

export function batteryPctLabel(agent) {
  if (!agent) return "—";
  const b = agent.battery;
  return `${Math.round(b <= 1 ? b * 100 : b)}%`;
}

export function buildFleetDialogueSlides(plan) {
  const state = simBridge.state;
  if (
    liveAiModeEnabled &&
    liveAiConnected === true &&
    liveAiCache.fleetSlides &&
    liveAiCache.tick === state?.timestep
  ) {
    return liveAiCache.fleetSlides;
  }

  const dDlg = activeDialogueTemplates();
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
  const candidates = rankVictims(state);
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
        mortalityRisk: top.mortality_risk_label,
        mortalityFactors: top.mortality_factors,
        bestAgent: top.best_agent,
      })
    );
    orchLines.push(`Mortality model: ${top.mortality_risk_label} risk from ${top.mortality_factors}.`);
  }
  const sacrificeAction = firstActionMatching(plan, (a) => a.task === "sacrificial_relay");
  if (sacrificeAction) {
    orchLines.push(`Decision hub authorized drone sacrifice: ${sacrificeAction.agent} will deplete for ${sacrificeAction.target}.`);
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
    const taskHuman = actionHuman(action.task);
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
    const victimFactors = candidates.find((c) => c.id === action.target)?.mortality_factors;
    if (victimFactors) cotLines.push(`Mortality factors: ${victimFactors}.`);
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

