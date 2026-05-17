import { $, PRESET_DEFAULTS, readConfig, setActivePreset, syncSimulationPresetClass } from "../config/presets.js";
import { applyTacticalBasemapStylePreset } from "../geo/tactical-basemap.js";
import { emitToast } from "./toast.js";
import { formatCotTranscript, scrollLatestCotIntoView, updateMissionLabels } from "./panels.js";
import { syncAiModeSegmentedUi, applyLiveAiModeFromUser } from "../ai/index.js";
import { setupTour } from "./tour.js";

let speedMultiplier = 1;

export function getSpeedMultiplier() {
  return speedMultiplier;
}

export function setSpeedMultiplier(v) {
  speedMultiplier = Number(v) || 1;
}

/**
 * @param {{ rebuildSimulation: (cfg: object) => void, refreshAutoTimer?: () => void }} ctx
 */
export function setupCommandCenter(ctx) {
  const { rebuildSimulation, refreshAutoTimer } = ctx;

  const bind = (id, labelId, fmt) => {
    const input = $(id);
    const label = $(labelId);
    if (!input || !label) return;
    const render = () => {
      label.textContent = fmt(input.value);
    };
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

  document.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.preset;
      if (!PRESET_DEFAULTS[key]) return;
      setActivePreset(key);
      document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      const p = PRESET_DEFAULTS[key];
      const set = (id, v) => {
        const el = $(id);
        if (el) {
          el.value = v;
          el.dispatchEvent(new Event("input"));
        }
      };
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
      rebuildSimulation(readConfig());
    });
  });

  const applyBtn = $("cfgApply");
  if (applyBtn) applyBtn.addEventListener("click", () => rebuildSimulation(readConfig()));

  const randBtn = $("cfgRandom");
  if (randBtn) {
    randBtn.addEventListener("click", () => {
      const seed = $("cfgSeed");
      if (seed) {
        seed.value = 1 + Math.floor(Math.random() * 998);
        seed.dispatchEvent(new Event("input"));
      }
      rebuildSimulation(readConfig());
    });
  }

  const cfgToggle = $("cfgToggle");
  const grid = $("ccGrid");
  if (cfgToggle && grid) {
    cfgToggle.addEventListener("click", () => grid.classList.toggle("cfg-collapsed"));
  }

  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".speed-btn").forEach((b) => b.classList.toggle("active", b === btn));
      setSpeedMultiplier(btn.dataset.speed);
      refreshAutoTimer?.();
    });
  });

  const copyBtn = $("copyJson");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(formatCotTranscript() || "");
        emitToast("default", "Fleet transcript copied");
      } catch {
        emitToast("default", "clipboard unavailable");
      }
    });
  }

  const jumpCot = $("cotJumpLatest");
  if (jumpCot) jumpCot.addEventListener("click", () => scrollLatestCotIntoView(true));

  const clearBtn = $("clearLog");
  const logEl = $("eventLog");
  if (clearBtn && logEl) {
    clearBtn.addEventListener("click", () => {
      logEl.innerHTML = "";
    });
  }

  const idIn = $("cfgMissionId");
  if (idIn) idIn.addEventListener("input", () => updateMissionLabels(readConfig()));

  updateMissionLabels(readConfig());
  applyTacticalBasemapStylePreset(readConfig().preset);
  syncSimulationPresetClass(readConfig().preset);

  syncAiModeSegmentedUi();
  const aiModeMock = $("aiModeMock");
  const aiModeGemma = $("aiModeGemma");
  if (aiModeMock) aiModeMock.addEventListener("click", () => applyLiveAiModeFromUser(false));
  if (aiModeGemma) aiModeGemma.addEventListener("click", () => applyLiveAiModeFromUser(true));

  setupTour();

  const bw = $("bwBar");
  if (bw) bw.className = "bw lvl-5";
}
