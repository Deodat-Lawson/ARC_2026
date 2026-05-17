import { $, PRESET_DEFAULTS, PRESET_VISUAL } from "../config/presets.js";
import { rankVictims } from "../sim/plan.js";
import { clamp } from "../sim/math.js";
import { simBridge } from "../sim/bridge.js";
import { povs, ui3d } from "../render/world3d.js";
import {
  fleetDialogueCot,
  FLEET_DIALOGUE_COT_BUILTIN,
  interpolate,
  cotFeedMaxBlocks,
  buildFleetDialogueSlides,
  syncThinkingFeed,
  syncBriefingFeed,
  syncLiveAiHudPending,
} from "../ai/index.js";
import { COT_FEED_AUTO_MIN_MS } from "../sim/timing.js";

let tickLabel;
let rescuedCount;
let priorityList;
let agentList;
let survivalChart;
let chartCtx;
let cotCarouselTrack;
let cotCarouselViewport;
let cotSlideLabel;

export const survivalHistory = [];

let cotFeedPrependedStep = -999;
let lastCotFeedWallMs = 0;
const cotFeedTranscriptChunks = [];

/**
 * @param {Partial<{
 *   tickLabel: Element,
 *   rescuedCount: Element,
 *   priorityList: Element,
 *   agentList: Element,
 *   survivalChart: HTMLCanvasElement | null,
 *   chartCtx: CanvasRenderingContext2D | null,
 *   cotCarouselTrack: Element | null,
 *   cotCarouselViewport: Element | null,
 *   cotSlideLabel: Element | null,
 * }>} els
 */
export function bindPanelsDom(els) {
  if (els.tickLabel != null) tickLabel = els.tickLabel;
  if (els.rescuedCount != null) rescuedCount = els.rescuedCount;
  if (els.priorityList != null) priorityList = els.priorityList;
  if (els.agentList != null) agentList = els.agentList;
  if (els.survivalChart !== undefined) survivalChart = els.survivalChart;
  if (els.chartCtx !== undefined) chartCtx = els.chartCtx;
  if (els.cotCarouselTrack !== undefined) cotCarouselTrack = els.cotCarouselTrack;
  if (els.cotCarouselViewport !== undefined) cotCarouselViewport = els.cotCarouselViewport;
  if (els.cotSlideLabel !== undefined) cotSlideLabel = els.cotSlideLabel;
}

export function primeCotFeedAutoThrottle() {
  lastCotFeedWallMs = performance.now() - COT_FEED_AUTO_MIN_MS;
}

export function resetCotFeedState() {
  cotFeedPrependedStep = -999;
  lastCotFeedWallMs = 0;
  cotFeedTranscriptChunks.length = 0;
  if (cotCarouselTrack) cotCarouselTrack.innerHTML = "";
}

export function recordSurvivalSample() {
  const state = simBridge.state;
  if (!state) return;
  const total = state.victims.length || 1;
  const alive = state.victims.filter((v) => v.status !== "dead").length;
  const rescued = state.victims.filter((v) => v.status === "rescued").length;
  survivalHistory.push({
    t: state.timestep,
    alive: alive / total,
    rescued: rescued / total,
  });
}

export function popCounter(el, val) {
  if (!el) return;
  el.textContent = val;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  setTimeout(() => el.classList.remove("pop"), 260);
}

function createCotTurnElement(turn) {
  const wrap = document.createElement("div");
  wrap.className = `cot-turn ${turn.kind} ${turn.cls || ""}`.trim();
  const feedUi = fleetDialogueCot?.ui?.feed ?? FLEET_DIALOGUE_COT_BUILTIN.ui.feed;

  if (turn.kind === "cot") {
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
          }),
        );
      }
    }
  }
  return lines.join("\n");
}

function updateCotFeedMeta(slides) {
  const el = cotSlideLabel;
  const state = simBridge.state;
  if (!el || !state) return;
  const panel = fleetDialogueCot?.ui?.panel ?? FLEET_DIALOGUE_COT_BUILTIN.ui.panel;
  const metaT =
    fleetDialogueCot?.ui?.meta?.latestTemplate ??
    FLEET_DIALOGUE_COT_BUILTIN.ui.meta.latestTemplate;
  const padT = `T+${String(state.timestep).padStart(3, "0")}`;
  const head = slides[0]?.title ?? panel?.slideLabelDefault ?? "—";
  el.textContent = interpolate(metaT, { padT, head });
}

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

export function scrollLatestCotIntoView(smooth = true) {
  const track = cotCarouselTrack;
  if (!track?.lastElementChild) return;
  track.lastElementChild.scrollIntoView({
    block: "start",
    inline: "nearest",
    behavior: smooth ? "smooth" : "instant",
  });
}

function updateFleetDialogueCarousel(plan, slidesPrebuilt = null) {
  if (!cotCarouselTrack || !simBridge.state) return;
  const state = simBridge.state;
  if (cotFeedPrependedStep === state.timestep) return;
  if (simBridge.hooks?.getTimer?.()) {
    const now = performance.now();
    if (now - lastCotFeedWallMs < COT_FEED_AUTO_MIN_MS) return;
    lastCotFeedWallMs = now;
  }
  cotFeedPrependedStep = state.timestep;
  const slides = slidesPrebuilt ?? buildFleetDialogueSlides(plan);
  const block = createCotFeedBlock(state.timestep, slides);
  cotCarouselTrack.appendChild(block);
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

export function formatCotTranscript() {
  const sep =
    fleetDialogueCot?.ui?.transcript?.chunkSeparator ??
    FLEET_DIALOGUE_COT_BUILTIN.ui.transcript.chunkSeparator;
  return cotFeedTranscriptChunks.join(sep);
}

/** After a live Gemma round: force a new carousel block and refresh meta. */
export function applyLiveFleetSlidesToDom(plan, slides) {
  cotFeedPrependedStep = -999;
  updateFleetDialogueCarousel(plan, slides);
  updateCotFeedMeta(slides);
}

export function renderPanels(plan) {
  const state = simBridge.state;
  if (!state || !tickLabel || !rescuedCount || !priorityList || !agentList) return;

  tickLabel.textContent = String(state.timestep).padStart(3, "0");
  if (rescuedCount.textContent !== String(state.rescued)) {
    rescuedCount.textContent = state.rescued;
  }

  const candidates = rankVictims(state);
  priorityList.innerHTML = candidates
    .map(
      (candidate) => `
    <div class="row">
      <strong>${candidate.id}</strong>
      <div>
        <div class="bar" style="--value: ${candidate.score * 100}%"><i></i></div>
        <span>${candidate.survival_pct}% · ${candidate.survival_steps}t · ${candidate.communication_status}</span>
      </div>
      <b class="tag">${candidate.score.toFixed(2)}</b>
    </div>
  `,
    )
    .join("");

  agentList.innerHTML = state.agents
    .map(
      (agent) => `
    <div class="row">
      <strong>${agent.id}</strong>
      <div>
        <div class="bar" style="--value: ${agent.battery}%"><i></i></div>
        <span>${agent.role} · ${agent.location.map((item) => Math.round(item)).join(", ")}</span>
      </div>
      <b class="tag">${Math.round(agent.battery)}%</b>
    </div>
  `,
    )
    .join("");

  syncThinkingFeed(plan);
  syncBriefingFeed(plan);
  syncLiveAiHudPending();
  const fleetDialogueSlides = buildFleetDialogueSlides(plan);
  updateCotFeedMeta(fleetDialogueSlides);
  updateFleetDialogueCarousel(plan, fleetDialogueSlides);
  updateCommandKpis(candidates);
  drawSurvivalChart();
  updateAgentCards(plan);
}

function drawSurvivalChart() {
  if (!chartCtx || !survivalChart || !simBridge.state) return;
  const state = simBridge.state;
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
  const state = simBridge.state;
  if (!state) return;
  const victims = state.victims;
  if (!victims.length) return;
  const top = trendH + 6;
  const barMaxH = Math.max(8, vicBand - 26);
  const n = victims.length;
  const barW = Math.max(2, Math.min(34, (W - 32) / (n + 1)));
  const gap = barW * 0.2;
  victims.forEach((v, i) => {
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

export function updateCommandKpis(candidates) {
  const state = simBridge.state;
  const total = state?.victims?.length || 0;
  const alive =
    state?.victims?.filter((v) =>
      v.status === "trapped" || v.status === "unknown" || v.status === "rescued").length || 0;
  const survivalRate = total ? Math.round((alive / total) * 100) : 0;
  const ofEl = $("rescuedOf");
  if (ofEl) ofEl.textContent = total;
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
  const lvl = survivalRate > 80 ? 5 : survivalRate > 60 ? 4 : survivalRate > 40 ? 3 : survivalRate > 20 ? 2 : 1;
  const bw = $("bwBar");
  if (bw) bw.className = `bw lvl-${lvl}`;
}

export function updateMissionLabels(cfg) {
  const preset = PRESET_DEFAULTS[cfg.preset] || PRESET_DEFAULTS.urban_quake;
  const vis = PRESET_VISUAL[cfg.preset] || PRESET_VISUAL.urban_quake;
  const idEl = $("msnId");
  if (idEl) idEl.textContent = `${cfg.missionId} · ${preset.label.split("· ")[1] || "MISSION"}`;
  const phaseEl = $("msnPhase");
  if (phaseEl) phaseEl.textContent = preset.phase;
  const gridBadge = $("gridBadge");
  if (gridBadge) gridBadge.textContent = `${cfg.grid} × ${cfg.grid}`;
  const geoEl = $("geoGridBadge");
  if (geoEl) {
    geoEl.textContent = vis.geoShort;
    geoEl.title = vis.geoTitle;
  }
}

export function updateAgentCards(plan) {
  const state = simBridge.state;
  if (!state) return;
  const planByAgent = new Map();
  if (plan?.mission_plan) {
    for (const a of plan.mission_plan) planByAgent.set(a.agent, a);
  }
  const agentCardEls = ui3d.agentCardEls;
  if (!agentCardEls) return;
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
  const entry = povs[0];
  const povSubEl = ui3d.povSubEl;
  if (povSubEl && entry) {
    const ag = state.agents.find((a) => a.id === entry.selectedId);
    if (ag) povSubEl.textContent = `${ag.role.replace("_", " ")} · battery ${Math.round(ag.battery)}%`;
  }
}
