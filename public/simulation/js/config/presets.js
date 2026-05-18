/** Drives MapLibre paint, 2D sim canvas tint, and 3D FPV environment per mission preset. */
export let currentScenePreset = "urban_quake";

export function setCurrentScenePreset(v) {
  currentScenePreset = v;
}

export const PRESET_VISUAL = {
  urban_quake: {
    geoShort: "FIRENZE",
    geoTitle: "Urban Quake / Hurricane theatre · Protomaps vector · Firenze extract (ODbL) · 300 m",
    basemap: {
      mask: "#0f1726",
      earth: "#121d2e",
      water: "#164969",
      landuse: "#1b2940",
      buildings: { fill: "#5a7392", outline: "#94a8c4", opacity: 0.92 },
      roads: { color: "#a9bdd5", opacity: 0.82 },
      roadLabels: { color: "#c9d6e7", halo: "#07101d", opacity: 0.76 },
    },
    canvas2d: {
      overlay: "rgba(4, 6, 10, 0.14)",
      gridStroke: "rgba(93, 255, 180, 0.05)",
      arterial: "rgba(60, 80, 110, 0.14)",
    },
    groundUpgrade: { color: 0x4a5562, emissive: 0x06121f, emissiveIntensity: 0.18 },
    scene3d: {
      background: 0x070d16,
      fogColor: 0x080f1a,
      fogDensity: 0.016,
      ambient: { color: 0x6b88aa, intensity: 0.35 },
      hemi: { sky: 0x5680c0, ground: 0x0a0f1a, intensity: 1.0 },
      key: { color: 0xfff0d8, intensity: 0.95 },
      fill: { color: 0x4a78b0, intensity: 0.35 },
      rim: { color: 0x00bfff, intensity: 0.7 },
      gridMat: {
        color: 0x0a1828,
        emissive: 0x001a33,
        emissiveIntensity: 0.4,
      },
      gridTex: { fill: "#04060a", stroke: "rgba(93, 255, 180, 0.32)", highlight: "rgba(130, 200, 255, 0.06)" },
      skyStops: [
        [0.0, "#08101a"],
        [0.45, "#1a1612"],
        [0.72, "#3a2418"],
        [0.88, "#5a3a22"],
        [1.0, "#1c1610"],
      ],
      toneExposure: 1.4,
      rendererClear: 0x02060f,
    },
  },
  wildfire: {
    geoShort: "WUI · GRID",
    geoTitle:
      "Wildland meadow tactical grid · abstract lattice (no city basemap, no civic building footprints)",
    basemap: {
      mask: "#1a0f08",
      earth: "#2a1810",
      water: "#4a3020",
      waterOpacity: 0.75,
      landuse: "#3d2214",
      landuseOpacity: 0.78,
      buildings: { fill: "#7a5844", outline: "#c4906a", opacity: 0.9 },
      roads: { color: "#e8bc8a", opacity: 0.74 },
      roadLabels: { color: "#f5dcc8", halo: "#1a0c06", opacity: 0.72 },
    },
    canvas2d: {
      /** Opaque woodland floor when vector basemap is hidden. */
      solidTerrainFill: "#140804",
      overlay: "rgba(26, 12, 6, 0.2)",
      gridStroke: "rgba(255, 140, 72, 0.08)",
      arterial: "rgba(120, 70, 40, 0.16)",
    },
    groundUpgrade: { color: 0x5a4538, emissive: 0x2a1008, emissiveIntensity: 0.24 },
    scene3d: {
      background: 0x1a0c08,
      fogColor: 0x2a1810,
      fogDensity: 0.021,
      ambient: { color: 0xc9a078, intensity: 0.42 },
      hemi: { sky: 0xffb060, ground: 0x1a0e08, intensity: 0.95 },
      key: { color: 0xffe8c8, intensity: 1.08 },
      fill: { color: 0x8a5030, intensity: 0.42 },
      rim: { color: 0xff6b2d, intensity: 0.55 },
      gridMat: {
        color: 0x2a1410,
        emissive: 0x331008,
        emissiveIntensity: 0.38,
      },
      gridTex: { fill: "#120804", stroke: "rgba(255, 120, 60, 0.34)", highlight: "rgba(255, 180, 90, 0.07)" },
      skyStops: [
        [0.0, "#1a0a04"],
        [0.38, "#3d1808"],
        [0.62, "#6c280c"],
        [0.82, "#9a4010"],
        [1.0, "#2a1008"],
      ],
      toneExposure: 1.35,
      rendererClear: 0x140804,
    },
  },
  industrial: {
    geoShort: "PLANT",
    geoTitle: "Industrial / structural theatre · cool steel palette · georeferenced grid (Firenze extract)",
    basemap: {
      mask: "#0a0c10",
      earth: "#12161e",
      water: "#1a2836",
      landuse: "#151c28",
      landuseOpacity: 0.68,
      buildings: { fill: "#4a5666", outline: "#8a9cb0", opacity: 0.9 },
      roads: { color: "#8a9cac", opacity: 0.78 },
      roadLabels: { color: "#c8d4e0", halo: "#05080c", opacity: 0.74 },
    },
    canvas2d: {
      overlay: "rgba(6, 10, 16, 0.18)",
      gridStroke: "rgba(140, 190, 240, 0.06)",
      arterial: "rgba(55, 75, 100, 0.15)",
    },
    groundUpgrade: { color: 0x3d4855, emissive: 0x081520, emissiveIntensity: 0.14 },
    scene3d: {
      background: 0x05070c,
      fogColor: 0x0a1018,
      fogDensity: 0.019,
      ambient: { color: 0x607890, intensity: 0.3 },
      hemi: { sky: 0x4a5c78, ground: 0x05080e, intensity: 0.88 },
      key: { color: 0xe8eef5, intensity: 0.82 },
      fill: { color: 0x2a4060, intensity: 0.38 },
      rim: { color: 0x6699cc, intensity: 0.48 },
      gridMat: {
        color: 0x0c121a,
        emissive: 0x0a1522,
        emissiveIntensity: 0.32,
      },
      gridTex: { fill: "#030508", stroke: "rgba(140, 180, 220, 0.28)", highlight: "rgba(100, 160, 220, 0.055)" },
      skyStops: [
        [0.0, "#030508"],
        [0.4, "#0a1018"],
        [0.65, "#152030"],
        [0.85, "#1a2838"],
        [1.0, "#080c12"],
      ],
      toneExposure: 1.22,
      rendererClear: 0x020308,
      /** IBL strength — lower reads closer to urban FPV (directional + fill). */
      environmentIntensity: 0.58,
    },
  },
};

export const PRESET_DEFAULTS = {
  urban_quake: {
    label: "MSN-001 · URBAN QUAKE / HURRICANE",
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

export let activePreset = "urban_quake";

export function setActivePreset(v) {
  activePreset = v;
}

export function $(id) { return document.getElementById(id); }

export function getPresetBasemap(key) {
  const vis = PRESET_VISUAL[key] || PRESET_VISUAL.urban_quake;
  return vis.basemap;
}

export function readConfig() {
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

export function syncSimulationPresetClass(presetKey) {
  const root = document.querySelector(".cc");
  if (!root) return;
  root.classList.remove("sim-preset-urban_quake", "sim-preset-wildfire", "sim-preset-industrial");
  const k = PRESET_VISUAL[presetKey] ? presetKey : "urban_quake";
  root.classList.add(`sim-preset-${k}`);
}
