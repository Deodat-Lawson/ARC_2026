/**
 * Legacy one-shot extractor: assumed a monolithic app.js with inlined world3d + AI.
 * Current tree uses modular `js/render/world3d/tactical-pov-shell.js` + `urban-quake.js` and `js/ai/index.js`.
 *
 * Run: node public/simulation/extract-modules.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const appPath = path.join(root, "app.js");

const lines = fs.readFileSync(appPath, "utf8").split(/\r?\n/);

/** Monolithic app.js was ~4k+ lines; short file means extraction slices are invalid. */
const LEGACY_MONOLITH_MIN_LINES = 3500;
if (lines.length < LEGACY_MONOLITH_MIN_LINES) {
  console.warn(
    `extract-modules.mjs: skipped (${lines.length} lines < ${LEGACY_MONOLITH_MIN_LINES}). ` +
      "Maintain world3d modules and ai/index.js directly; tactical shell lives in tactical-pov-shell.js.",
  );
  process.exit(0);
}

const joinRange = (a, b) => lines.slice(a, b + 1).join("\n");

/* -------- world3d (urban-quake implementation module) -------- */
const wHeader = `import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import {
  PRESET_VISUAL,
  activePreset,
  currentScenePreset,
  setCurrentScenePreset,
} from "../../config/presets.js";
import { pointNearBuilding } from "../../sim/collision.js";
import { lerp } from "../../sim/math.js";
import {
  ui3d,
  bindWorld3dUi,
  povs,
  buildAgentSelector,
  teardownAgentSelector,
  currentTargetFor,
  currentTargetIdFor,
} from "./tactical-pov-shell.js";

export const world = {
  scene: null,
  visualPresetForAssets: "urban_quake",
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
  initialized: false,
};

`;

// 1-based line nums from prior read: 1901 hash01 .. 3780 end handleGlobal; 3814 fitToSize .. 4655 teardown
const wPart1 = joinRange(1900, 3779);
const wPart2 = joinRange(3813, 4654);
let wBody = `${wPart1}\n${wPart2}`;

wBody = wBody.replace(/^function init3D\(scenario, presetKey\)/m, "export function init3D(scenario, presetKey, povCols)");
wBody = wBody.replace(/\bagentSelectorHost\b/g, "ui3d.agentSelectorHost");
wBody = wBody.replace(/\bagentCardEls\b/g, "ui3d.agentCardEls");
wBody = wBody.replace(/\bpovSubEl\b/g, "ui3d.povSubEl");
wBody = wBody.replace(/\bDEFAULT_POV_AGENTS\b/g, "ui3d.DEFAULT_POV_AGENTS");

wBody = wBody.replace(
  /^function update3D\(t\) \{\n  if \(!world\.initialized \|\| !state\) return;\n  const frac = Math\.min\(1, Math\.max\(0, \(performance\.now\(\) - lastTickAt\) \/ MS_PER_TICK\)\);/m,
  `export function update3D(t, sim) {
  const { state, plan, lastTickAt, msPerTick } = sim;
  if (!world.initialized || !state) return;
  const frac = Math.min(1, Math.max(0, (performance.now() - lastTickAt) / msPerTick));`,
);

wBody = wBody.replace(/\(MS_PER_TICK \/ 1000\)/g, "(msPerTick / 1000)");

wBody = wBody.replace(/^function currentTargetFor\(agent\)/m, "function currentTargetFor(agent, state, plan)");
wBody = wBody.replace(/^function currentTargetIdFor\(agent\)/m, "function currentTargetIdFor(agent, plan)");
wBody = wBody.replace(/const target = currentTargetFor\(driver\);/g, "const target = currentTargetFor(driver, state, plan);");
wBody = wBody.replace(/const targetId = currentTargetIdFor\(driver\);/g, "const targetId = currentTargetIdFor(driver, plan);");

wBody = wBody.replace(/^function teardown3D\(\)/m, "export function teardown3D()");

// selectAgent uses state
wBody = wBody.replace(
  /if \(ui3d\.povSubEl && state\) \{\n    const ag = state\.agents\.find/g,
  "if (ui3d.povSubEl && simBridge.state) {\n    const ag = simBridge.state.agents.find",
);

fs.mkdirSync(path.join(root, "js", "render", "world3d"), { recursive: true });
fs.writeFileSync(path.join(root, "js", "render", "world3d", "urban-quake.js"), wHeader + wBody + "\n");
console.log("wrote world3d/urban-quake.js");

/* -------- ai (two chunks) -------- */
const aiHeader = `import { rankVictims } from "../sim/plan.js";
import { $ } from "../config/presets.js";
import { povs } from "../render/world3d/index.js";
import { simBridge } from "../sim/bridge.js";

`;

const aiA = joinRange(101, 947); // FLEET... resetDecisionFeeds (0-based: 101-947 line 102-948)
const aiB = joinRange(1235, 1423); // agentDialogueClass .. buildFleetDialogueSlides

let aiBody = `${aiA}\n${aiB}`;

aiBody = aiBody.replace(
  /function buildSimulationContext\(plan\) \{\n  if \(!state \|\| !plan\)/,
  "function buildSimulationContext(plan) {\n  const state = simBridge.state;\n  if (!state || !plan)",
);

// Export key funcs - add export to list
const exportNames = [
  "interpolate",
  "cotFeedMaxBlocks",
  "cotFeedSlideMax",
  "applyFleetDialogueCotDom",
  "readInitialLiveAiMode",
  "persistLiveAiMode",
  "syncAiModeSegmentedUi",
  "applyLiveAiModeFromUser",
  "releaseStuckLiveAiRound",
  "simulationTickIntervalMs",
  "scheduleLiveAiRound",
  "setAiStatusBadge",
  "capturePoV",
  "buildSimulationContext",
  "pushAgentHistory",
  "callGemmaChat",
  "streamGemmaToThinking",
  "buildLiveFleetSlides",
  "applyLiveFleetSlides",
  "fetchOrchestrator",
  "fetchDroneAlpha",
  "fetchTrackBeta",
  "fetchRelayGamma",
  "probeLmStudio",
  "triggerLiveAiRound",
  "resetLiveAiState",
  "splitThinkingLog",
  "appendThinkingEntry",
  "playThinkingQueue",
  "queueThinkingLog",
  "appendBriefingRow",
  "buildThinkingNarrative",
  "syncThinkingFeed",
  "syncBriefingFeed",
  "syncLiveAiHudPending",
  "resetDecisionFeeds",
  "agentDialogueClass",
  "pickDialoguePeer",
  "batteryPctLabel",
  "buildFleetDialogueSlides",
];

for (const name of exportNames) {
  const re = new RegExp(`^function ${name}\\(`, "m");
  aiBody = aiBody.replace(re, `export function ${name}(`);
}

const exportLets = [
  "let fleetDialogueCot",
  "let liveAiModeEnabled",
  "let liveAiRequestId",
  "let liveAiInFlight",
  "let liveAiConnected",
  "let liveAiCache",
  "let liveAiPendingPlan",
  "let liveAiRoundStartedAt",
];

for (const l of exportLets) {
  const name = l.split(" ")[1];
  aiBody = aiBody.replace(new RegExp(`^${l}`, "m"), `export ${l}`);
}

// const that need export
aiBody = aiBody.replace(/^const AI_ENDPOINT/m, "export const AI_ENDPOINT");
aiBody = aiBody.replace(/^const LIVE_AI_STORAGE_KEY/m, "export const LIVE_AI_STORAGE_KEY");
aiBody = aiBody.replace(/^const GEMMA_ROUND_TIMEOUT_MS/m, "export const GEMMA_ROUND_TIMEOUT_MS");
aiBody = aiBody.replace(/^const FLEET_DIALOGUE_COT_BUILTIN/m, "export const FLEET_DIALOGUE_COT_BUILTIN");
aiBody = aiBody.replace(/^const liveAiCache/m, "export const liveAiCache");

fs.mkdirSync(path.join(root, "js", "ai"), { recursive: true });
fs.writeFileSync(path.join(root, "js", "ai", "index.js"), aiHeader + aiBody + "\n");
console.log("wrote ai/index.js");

console.log("Done. Now manually stitch app.js, ui.js, and fix any export issues.");
