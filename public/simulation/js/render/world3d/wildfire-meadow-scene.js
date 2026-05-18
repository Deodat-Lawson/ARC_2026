/**
 * Shared meadow + EZ-Tree scene graph (dirt, grass tufts, flowers, trees, sky helpers).
 * Used by wildfire.js and wildfire-meadow-preview.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Tree, TreePreset } from "@dgreenheck/ez-tree";

/** Mutated each frame by consumers for grass wind shader injection. */
export const grassWindTimeUniform = { value: 0 };

export const SKY_TOP = new THREE.Color(0x4a9fe8);
export const SKY_BOTTOM = new THREE.Color(0xb8dcf5);
export const FOG_COLOR_HEX = 0xc5e2f5;

/** One scene unit corresponds to one metre in the XY plane for this meadow (xz ∈ ±half). */
export const MEADOW_SIDE_METERS = 200;
export const MEADOW_HALF_METERS = MEADOW_SIDE_METERS * 0.5;

/**
 * Density reference disk (ρ baseline from the legacy tight packing).
 * `FOREST_HALF_EXTENT`, `PLACEMENT_HALF_SCALE`: legacy constant names retained for tooling.
 */
export const FOREST_HALF_EXTENT = 52;
export const PLACEMENT_HALF_SCALE = 0.465;

/** Reference instances / grass tufts / flowers counted on LEGACY_DISK; scaled to rectangular meadow area. */
export const REFERENCE_TREE_INSTANCES = 276;
export const REFERENCE_GRASS_TUFTS = 7200;
export const REFERENCE_FLOWERS = 560;

const LEGACY_DISK_HALF_M =
  (FOREST_HALF_EXTENT - 1) * PLACEMENT_HALF_SCALE;
const LEGACY_DISK_AREA_SQ_M = Math.PI * LEGACY_DISK_HALF_M ** 2;
const MEADOW_AREA_SQ_M = MEADOW_SIDE_METERS * MEADOW_SIDE_METERS;
const MEADOW_INSTANCE_DENSITY_SCALE = MEADOW_AREA_SQ_M / LEGACY_DISK_AREA_SQ_M;

/** ρ-matched EZ-Tree instance target for MEADOW_SIDE² (scales with area vs legacy disk). */
export const TREE_DENSITY_TARGET = Math.max(1, Math.round(REFERENCE_TREE_INSTANCES * MEADOW_INSTANCE_DENSITY_SCALE));

/**
 * EZ-Tree is fully procedural — each mesh costs ms on the main thread. Keep modest for playable load/FPS.
 * Raise toward `TREE_DENSITY_TARGET` only on profiling; use `TREE_DENSITY_TARGET` / `EFFECTIVE_TREE_COUNT` scaling for crown size.
 */
export const EZ_TREE_INSTANCE_CAP = 600;

export const EFFECTIVE_TREE_COUNT = Math.min(TREE_DENSITY_TARGET, EZ_TREE_INSTANCE_CAP);
/** Exported count used when enumerating meshes to build. */
export const TREE_COUNT = EFFECTIVE_TREE_COUNT;

/** rAF slicing: approximate ms budget while mounting EZ‑Trees — keeps interaction responsive during load. */
export const EZ_TREE_STREAM_MS_PER_FRAME = 11;
/** Safety clamp on trees spawned per animation frame even if budget is high. */
export const EZ_TREE_STREAM_MAX_PER_TICK = 42;

/** Grass is cheap batched geometry; cap avoids init stalls on large meadows. */
const GRASS_INSTANCES_HARD_CAP = 12_800;
/** Billboard flowers — modest cap saves matrix fill & overdraw. */
const FLOWER_INSTANCES_HARD_CAP = 2_200;

export const GRASS_TUFT_COUNT = Math.min(
  GRASS_INSTANCES_HARD_CAP,
  Math.max(900, Math.round(REFERENCE_GRASS_TUFTS * MEADOW_INSTANCE_DENSITY_SCALE)),
);
export const FLOWER_COUNT = Math.min(
  FLOWER_INSTANCES_HARD_CAP,
  Math.max(96, Math.round(REFERENCE_FLOWERS * MEADOW_INSTANCE_DENSITY_SCALE)),
);

/** Legacy dirt plane outer edge (~128); used only to proportion lights/fog to the new meadow. */
export const LEGACY_GROUND_PLANE_SIDE_METRES = FOREST_HALF_EXTENT * 2 + 24;

export const MEADOW_FOG_NEAR = Math.round((22 / LEGACY_GROUND_PLANE_SIDE_METRES) * MEADOW_SIDE_METERS);
export const MEADOW_FOG_FAR = Math.round((238 / LEGACY_GROUND_PLANE_SIDE_METRES) * MEADOW_SIDE_METERS);

/** Multiply legacy sun positions `(52,76,38)` so highlights match enlarged terrain. */
export const WILDFIRE_LIGHT_LEGACY_SCALE = MEADOW_SIDE_METERS / LEGACY_GROUND_PLANE_SIDE_METRES;

export const FOREST_PRESETS = ["Oak Small", "Aspen Small", "Ash Small", "Pine Small"];

/** Crowning / surface fire centroid (XZ, metres from meadow origin). */
export const WILDFIRE_BURN_ORIGIN_METERS_X = MEADOW_SIDE_METERS * 0.124;
export const WILDFIRE_BURN_ORIGIN_METERS_Z = MEADOW_SIDE_METERS * -0.146;

/** Radius for dense crown + ember/smoke footprint (metres — keep small vs meadow so UAV/UGV retain corridors). */
export const WILDFIRE_BURN_PATCH_RADIUS_METERS = Math.min(14, MEADOW_HALF_METERS * 0.12);

/** Planner buffer (metres) added to burn disc when mapping hazards to tactical grid rects. */
export const WILDFIRE_BURN_NAV_CLEARANCE_METERS = 8;

/** Portion [0–1] of EZ-trees clustered around burn zones (remainder stays uniform meadow). */
export const WILDFIRE_BURN_CLUSTER_TREE_BIAS = 0.4;

/**
 * Multiple burn patches (world XZ, metres). `intensity` ~ relative severity (0.15–1+); drives VFX + light.
 * Tree clustering is weighted by `intensity × radius²` so larger / hotter patches pull more crowns.
 */
export const WILDFIRE_BURN_ZONES = [
  {
    ox: WILDFIRE_BURN_ORIGIN_METERS_X,
    oz: WILDFIRE_BURN_ORIGIN_METERS_Z,
    radiusMeters: WILDFIRE_BURN_PATCH_RADIUS_METERS,
    intensity: 1,
    label: "crown-head",
  },
  {
    ox: MEADOW_SIDE_METERS * -0.05,
    oz: MEADOW_SIDE_METERS * 0.086,
    radiusMeters: 6.5,
    intensity: 0.32,
    label: "ember-spot",
  },
  {
    ox: MEADOW_SIDE_METERS * 0.102,
    oz: MEADOW_SIDE_METERS * -0.062,
    radiusMeters: 8.5,
    intensity: 0.48,
    label: "line-rear",
  },
  /** Dispersed spotting — compact radii leave corridors between patches. */
  {
    ox: MEADOW_SIDE_METERS * -0.34,
    oz: MEADOW_SIDE_METERS * 0.21,
    radiusMeters: 5,
    intensity: 0.22,
    label: "spot-nw",
  },
  {
    ox: MEADOW_SIDE_METERS * 0.29,
    oz: MEADOW_SIDE_METERS * 0.17,
    radiusMeters: 4.5,
    intensity: 0.24,
    label: "spot-ne",
  },
  {
    ox: MEADOW_SIDE_METERS * -0.21,
    oz: MEADOW_SIDE_METERS * -0.33,
    radiusMeters: 5.2,
    intensity: 0.26,
    label: "spot-sw",
  },
  {
    ox: MEADOW_SIDE_METERS * 0.36,
    oz: MEADOW_SIDE_METERS * 0.05,
    radiusMeters: 4,
    intensity: 0.18,
    label: "spot-e",
  },
  {
    ox: MEADOW_SIDE_METERS * -0.06,
    oz: MEADOW_SIDE_METERS * -0.31,
    radiusMeters: 4.6,
    intensity: 0.2,
    label: "spot-s",
  },
  {
    ox: MEADOW_SIDE_METERS * 0.13,
    oz: MEADOW_SIDE_METERS * 0.34,
    radiusMeters: 4.8,
    intensity: 0.21,
    label: "spot-nnear",
  },
  {
    ox: MEADOW_SIDE_METERS * -0.39,
    oz: MEADOW_SIDE_METERS * -0.07,
    radiusMeters: 4.2,
    intensity: 0.16,
    label: "spot-w",
  },
];

function clampBurnAxis(v, hi) {
  return Math.max(0, Math.min(hi, v));
}

/**
 * Fire hazard footprints for `pointNearBuilding` / `avoidBuildingStep` (grid coords, same as victim cells).
 * Each burn patch is inflated by {@link WILDFIRE_BURN_NAV_CLEARANCE_METERS} for routing margin.
 *
 * Meadow XZ spans one cell-aligned map: metre offset maps from scene centre ±{@link MEADOW_SIDE_METERS}/2.
 * @returns {{ x: number, z: number, w: number, d: number }[]}
 */
export function wildfireBurnAvoidanceRects(scenario) {
  const sz = scenario?.map?.size;
  if (!Array.isArray(sz) || sz.length < 2 || sz[0] < 2 || sz[1] < 2) return [];
  let cols = Math.floor(sz[0]);
  let rows = Math.floor(sz[1]);
  if (!(cols >= 2 && rows >= 2)) return [];

  const sx = cols - 1;
  const sy = rows - 1;

  /** Centre-origin metres → fractional grid along [0, sx]. */
  const toGridXZ = (xm, zm) => ({
    x: (xm / MEADOW_SIDE_METERS + 0.5) * sx,
    z: (zm / MEADOW_SIDE_METERS + 0.5) * sy,
  });

  const margin = WILDFIRE_BURN_NAV_CLEARANCE_METERS;
  /** @type {{ x: number, z: number, w: number, d: number }[]} */
  const out = [];

  const zones = WILDFIRE_BURN_ZONES;
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    const rEff = Math.max(0.5, z.radiusMeters + margin);
    const cg = toGridXZ(z.ox, z.oz);
    const halfGx = (rEff / MEADOW_SIDE_METERS) * sx;
    const halfGz = (rEff / MEADOW_SIDE_METERS) * sy;
    const x0 = clampBurnAxis(cg.x - halfGx, sx);
    const z0 = clampBurnAxis(cg.z - halfGz, sy);
    const x1 = clampBurnAxis(cg.x + halfGx, sx);
    const z1 = clampBurnAxis(cg.z + halfGz, sy);
    const w = Math.max(1e-3, x1 - x0);
    const d = Math.max(1e-3, z1 - z0);
    out.push({ x: x0, z: z0, w, d });
  }
  return out;
}

/**
 * Fire risk discs for tactical sim / map2d: matches 3D {@link WILDFIRE_BURN_ZONES}
 * projected onto square grid `G×G`, same mapping as {@link wildfireBurnAvoidanceRects}.
 *
 * `center` and `radius` are **fractional** grid units (consistent with legacy `drawRiskZones`).
 * @returns {{ id: string, center: [number, number], radius: number, type: string, risk: number, meadowLabel?: string }[]}
 */
export function meadowFireRiskZonesForGrid(gridDim) {
  const G = Math.max(2, gridDim | 0);
  const span = Math.max(1, G - 1);
  const zs = WILDFIRE_BURN_ZONES;
  /** @type {{ id: string, center: [number, number], radius: number, type: string, risk: number, meadowLabel?: string }[]} */
  const out = [];
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    const rEff = Math.max(0.4, z.radiusMeters + WILDFIRE_BURN_NAV_CLEARANCE_METERS);
    const cx = (z.ox / MEADOW_SIDE_METERS + 0.5) * span;
    const cy = (z.oz / MEADOW_SIDE_METERS + 0.5) * span;
    const radius = (rEff / MEADOW_SIDE_METERS) * span;
    const inten = typeof z.intensity === "number" ? z.intensity : 1;
    const risk = Math.min(0.95, Math.max(0.12, 0.14 + Math.min(inten, 1.35) * 0.62));
    out.push({
      id: `WF-${i + 1}-${z.label ?? "burn"}`,
      center: [cx, cy],
      radius,
      type: "fire",
      risk,
      meadowLabel: typeof z.label === "string" ? z.label : undefined,
    });
  }
  return out;
}

/** Average metre span of one tactical grid step (meadow slab maps `cols×rows` → `MEADOW_SIDE_METERS²`). */
export function meadowAverageMetresPerCell(cols, rows) {
  const c = Math.max(2, Math.floor(cols) || 2);
  const r = Math.max(2, Math.floor(rows) || 2);
  const sx = c - 1;
  const sy = r - 1;
  return (MEADOW_SIDE_METERS / sx + MEADOW_SIDE_METERS / sy) * 0.5;
}

/**
 * Tactical cell indices (`ix`,`iy`) with urban-style centre semantics → meadow world XZ in metres,
 * inverse of burn-rect projection in {@link wildfireBurnAvoidanceRects}.
 */
export function meadowGridCellCenterToWorldMeters(ixc, iyc, cols, rows) {
  const c = Math.max(2, Math.floor(cols) || 2);
  const r = Math.max(2, Math.floor(rows) || 2);
  const sx = c - 1;
  const sy = r - 1;
  return {
    x: MEADOW_SIDE_METERS * (((ixc + 0.5) / sx) - 0.5),
    z: MEADOW_SIDE_METERS * (((iyc + 0.5) / sy) - 0.5),
  };
}

/** @returns {(ixc: number, iyc: number) => { x: number; z: number }}} */
export function makeMeadowGridToWorldXZ(cols, rows) {
  return (ixc, iyc) => meadowGridCellCenterToWorldMeters(ixc, iyc, cols, rows);
}

function applyForestLodCaps(o) {
  // Heavy LOD: trees in a 200m meadow read as silhouettes more than as individual
  // branches. Cutting branches/segments/sections halves per-tree geometry + the
  // per-frame `.update()` cost on the EZ-Tree skin without visibly hurting fidelity.
  const ch = o.branch.children;
  for (const k of Object.keys(ch)) {
    const n = Number(k);
    const maxN = n === 0 ? 8 : n === 1 ? 4 : 3;
    ch[k] = Math.min(ch[k], maxN);
  }
  o.leaves.count = Math.min(o.leaves.count ?? 20, 12);
  for (let lvl = 0; lvl <= 3; lvl++) {
    const key = String(lvl);
    if (o.branch.segments[key] != null) o.branch.segments[key] = Math.min(o.branch.segments[key], 3);
    if (o.branch.sections[key] != null) o.branch.sections[key] = Math.min(o.branch.sections[key], 6);
  }
}

function optionsFromPreset(presetName) {
  const src = TreePreset[presetName];
  if (!src) return structuredClone(TreePreset["Oak Small"]);
  const o = structuredClone(src);
  applyForestLodCaps(o);
  return o;
}

function fract01(n) {
  return n - Math.floor(n);
}

/** Cheap smooth value noise (deterministic, tile-friendly low freq). */
function vn2(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const u = tx * tx * (3 - 2 * tx);
  const v = ty * ty * (3 - 2 * ty);
  const dot = (ix, iy) => fract01(Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453);
  const h00 = dot(x0, y0);
  const h10 = dot(x0 + 1, y0);
  const h01 = dot(x0, y0 + 1);
  const h11 = dot(x0 + 1, y0 + 1);
  return h00 + (h10 - h00) * u + (h01 - h00) * v + (h00 - h10 - h01 + h11) * u * v;
}

function fbm2(x, y, octaves) {
  let amp = 0.52;
  let sum = 0;
  let div = 0;
  let xx = x;
  let yy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vn2(xx, yy);
    div += amp;
    xx *= 2.04;
    yy *= 2.04;
    amp *= 0.5;
  }
  return sum / div;
}

/**
 * Forest-floor mud: layered FBM color + grayscale roughness + tangent normals — no baked image files.
 * @returns {{ map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; normalMap: THREE.CanvasTexture }}
 */
function createWildfireDirtGroundTextures() {
  const size = 512;
  const N = size * size;
  const hCell = new Float32Array(N);
  const grain = new Float32Array(N);

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const idx = j * size + i;
      const big = fbm2(u * 7.1, v * 7.1, 4);
      const med = fbm2(u * 18.5 + 5.1, v * 18.5 + 2.3, 3);
      const tiny = fbm2(u * 69 + 11, v * 69 + 8, 2);
      hCell[idx] = big * 0.52 + med * 0.3 + tiny * 0.18;
      grain[idx] = tiny;
    }
  }

  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < N; i++) {
    hMin = Math.min(hMin, hCell[i]);
    hMax = Math.max(hMax, hCell[i]);
  }
  const hSpan = hMax - hMin || 1;
  for (let i = 0; i < N; i++) hCell[i] = (hCell[i] - hMin) / hSpan;

  /** @type {(xi: number, yi: number) => number} */
  const sampH = (xi, yi) => {
    const cx = xi < 0 ? 0 : xi > size - 1 ? size - 1 : xi;
    const cy = yi < 0 ? 0 : yi > size - 1 ? size - 1 : yi;
    return hCell[cy * size + cx];
  };

  /** @param linearData Roughness/normal maps (`NoColorSpace`); albedo stays sRGB. */
  const imageDataToTexture = (data, linearData) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (ctx) ctx.putImageData(data, 0, 0);
    tex.needsUpdate = true;
    tex.colorSpace = linearData ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    return tex;
  };

  const albedoData = new ImageData(size, size);
  const roughData = new ImageData(size, size);
  const normData = new ImageData(size, size);

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = j * size + i;
      const t = hCell[idx];
      const g = grain[idx];
      const pit = t < 0.38 ? (0.38 - t) / 0.38 : 0;

      let r = 46 + t * 64 + g * 36 - pit * 22;
      let grn = 30 + t * 48 + g * 18 - pit * 16;
      let b = 17 + t * 30 + g * 12 - pit * 10;

      /** Slightly cooler hue in troughs — reads as damp soil vs sun-dry ridges. */
      grn += pit * 4;
      b += pit * 5;
      r -= pit * 3;

      const speck = fract01(Math.sin(i * 35.2 + j * 71.9) * 4141.27);
      if (speck < 0.032) {
        r *= 0.63;
        grn *= 0.64;
        b *= 0.65;
      }

      const aBase = idx * 4;
      albedoData.data[aBase] = Math.min(255, Math.max(0, Math.round(r)));
      albedoData.data[aBase + 1] = Math.min(255, Math.max(0, Math.round(grn)));
      albedoData.data[aBase + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoData.data[aBase + 3] = 255;

      const rough = 0.2 + g * 0.62 + t * 0.2;
      const R = Math.min(255, Math.max(0, Math.round(rough * 255)));
      roughData.data[aBase] = R;
      roughData.data[aBase + 1] = R;
      roughData.data[aBase + 2] = R;
      roughData.data[aBase + 3] = 255;

      const dx = sampH(i + 1, j) - sampH(i - 1, j);
      const dy = sampH(i, j + 1) - sampH(i, j - 1);
      let nx = -dx * 5.8;
      let ny = -dy * 5.8;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      normData.data[aBase] = Math.round((nx * 0.5 + 0.5) * 255);
      normData.data[aBase + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normData.data[aBase + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normData.data[aBase + 3] = 255;
    }
  }

  return {
    map: imageDataToTexture(albedoData, false),
    roughnessMap: imageDataToTexture(roughData, true),
    normalMap: imageDataToTexture(normData, true),
  };
}

function createGrassTuftTexture() {
  const w = 58;
  const h = 176;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  if (!ctx) {
    tex.needsUpdate = true;
    return tex;
  }

  ctx.clearRect(0, 0, w, h);

  const strokes = 16 + Math.floor(Math.random() * 5);
  for (let s = 0; s < strokes; s++) {
    const cx = w * 0.5 + (Math.random() - 0.5) * w * 0.35;
    const bw = 2 + Math.random() * 5;
    const tilt = (Math.random() - 0.5) * 0.28;
    const g = ctx.createLinearGradient(cx - bw, h, cx + bw, 0);
    const hue = 78 + Math.random() * 44;
    const lightBot = 22 + Math.random() * 12;
    const lightTop = 42 + Math.random() * 22;
    g.addColorStop(0, `hsla(${hue}, 55%, ${lightBot}%, 0.92)`);
    g.addColorStop(0.55, `hsla(${hue + 8}, 48%, ${lightTop * 0.85}%, 0.75)`);
    g.addColorStop(1, `hsla(${hue + 15}, 42%, ${lightTop}%, 0.08)`);
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, h * 0.97);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(-bw * 0.5, 0);
    ctx.quadraticCurveTo(-bw * 0.3, -h * 0.55, 0, -h * (0.88 + Math.random() * 0.08));
    ctx.quadraticCurveTo(bw * 0.35, -h * 0.45, bw * 0.55, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let y = 0; y < h; y++) {
    const ny = y / (h - 1);
    const edgeFade = Math.pow(Math.min(ny / 0.14, 1), 1.8);
    const horiz = Math.sin((ny * Math.PI * 0.95) ** 1.1);
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1);
      const cx = Math.abs(nx - 0.5) * 2;
      const lateral = 1 - Math.pow(cx, 2.2) * 0.92;
      const i = (y * w + x) * 4;
      let a = d[i + 3] / 255;
      a *= lateral * edgeFade * (0.72 + horiz * 0.28);
      d[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  tex.needsUpdate = true;
  return tex;
}

function createGrassTuftCrossGeometry() {
  const gw = 0.52;
  const gh = 0.76;
  const g0 = new THREE.PlaneGeometry(gw, gh);
  g0.translate(0, gh * 0.5, 0);
  const g1 = new THREE.PlaneGeometry(gw, gh);
  g1.rotateY(Math.PI / 2);
  g1.translate(0, gh * 0.5, 0);
  const merged = mergeGeometries([g0, g1]);
  return merged ?? g0;
}

function createFlowerSpriteTexture() {
  const s = 48;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) {
    tex.needsUpdate = true;
    return tex;
  }
  const g = ctx.createRadialGradient(s * 0.5, s * 0.52, 2, s * 0.5, s * 0.5, s * 0.42);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.needsUpdate = true;
  return tex;
}

export function createSkyDomeMesh() {
  const r = Math.max(MEADOW_HALF_METERS * 2.95, 780);
  const geo = new THREE.SphereGeometry(r, 36, 18);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: SKY_TOP.clone() },
      bottomColor: { value: SKY_BOTTOM.clone() },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying float vH;
      void main() {
        float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottomColor, topColor, pow(t, 0.78));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "wildfire_sky";
  mesh.frustumCulled = false;
  return mesh;
}

function fractBias01(ix, salt = 9282.731) {
  const u = Math.sin(ix * 991.734 + salt) * 8349.9284;
  return u - Math.floor(u);
}

/**
 * Deterministic pick — biases toward hotspots with larger `intensity × radius²`.
 * @param {readonly { intensity?: number; radiusMeters: number }[]} zones
 */
function weightedBurnZoneIndex(ix, zones, salt) {
  let wsum = 0;
  const n = zones.length;
  for (let zi = 0; zi < n; zi++) {
    const z = zones[zi];
    const iq = THREE.MathUtils.clamp(z.intensity ?? 1, 0.01, 2.5);
    wsum += iq * z.radiusMeters * z.radiusMeters;
  }
  if (!(wsum > 1e-6)) return 0;
  let u = fractBias01(ix, salt ?? 661.073) * wsum;
  for (let zi = 0; zi < n; zi++) {
    const z = zones[zi];
    const iq = THREE.MathUtils.clamp(z.intensity ?? 1, 0.01, 2.5);
    u -= iq * z.radiusMeters * z.radiusMeters;
    if (u <= 0) return zi;
  }
  return n - 1;
}

/**
 * Concentrated flare + drifting smoke + flash-point light anchored at world (ox,oz).
 * Returns a tick; consumers aggregate via {@link attachWildfireBurnZonesFromConfig}.
 * @param {{ intensity?: number; zoneIndex?: number }} [opts] `intensity` scales VFX & lights (approx. fire severity).
 * @returns {(elapsed:number)=>void}
 */
function attachWildfireBurnInferno(meadowRoot, ox, oz, burntRadiusMetres, opts) {
  const zoneIndex = opts?.zoneIndex ?? -1;
  const Iraw = THREE.MathUtils.clamp(opts?.intensity ?? 1, 0.06, 1.55);
  const Ieff = Iraw ** 0.94;
  /** Optional global trim on particle counts (1 = unchanged). Lets callers cheap-out distant spot fires. */
  const particleMul = THREE.MathUtils.clamp(opts?.particleMul ?? 1, 0.1, 1);
  /** Ground footprint multiplier — weak fires occupy a visibly smaller halo. */
  const footMul = THREE.MathUtils.clamp(0.74 + Math.sqrt(Ieff) * 0.36, 0.72, 1.26);
  const nMulSmoke = THREE.MathUtils.clamp(0.38 + Ieff * 0.82, 0.28, 1.42) * particleMul;
  const nMulFlame = THREE.MathUtils.clamp(0.22 + Ieff * 0.96, 0.14, 1.52) * particleMul;
  const opMul = THREE.MathUtils.clamp(0.48 + Ieff * 0.65, 0.42, 1.14);
  const sizeMul = THREE.MathUtils.clamp(0.76 + Ieff * 0.38, 0.7, 1.28);
  const riseMul = THREE.MathUtils.clamp(0.86 + Ieff * 0.22, 0.82, 1.22);
  const turbMul = THREE.MathUtils.clamp(0.72 + Ieff * 0.38, 0.65, 1.38);
  const lampLightMul = THREE.MathUtils.clamp(0.34 + Ieff * 0.82, 0.28, 1.08);
  const flickAmpOverall = THREE.MathUtils.clamp(0.38 + Ieff * 0.78, 0.25, 1.15);

  // Global ~40% trim on every smoke/flame layer — the per-frame JS step over each
  // Points layer (sin/cos/hypot per particle) was dominating update3D. Trimming
  // through these two helpers keeps the existing per-layer count mix intact while
  // halving the work for the dense base layers.
  const COUNT_TRIM = 0.6;
  /** @returns {number} */
  function nSmoke(base) {
    return Math.max(18, Math.round(base * nMulSmoke * COUNT_TRIM));
  }
  /** @returns {number} */
  function nFlame(base) {
    return Math.max(8, Math.round(base * nMulFlame * COUNT_TRIM));
  }

  /** Per-zone temporal offset — keeps hotspots from pulsing in lockstep. */
  const phaseOff = (zoneIndex >= 0 ? zoneIndex * 2.983 : 0) + burntRadiusMetres * 0.037;

  const g = new THREE.Group();
  g.name = zoneIndex >= 0 ? `wildfire_burn_inferno_z${zoneIndex}` : "wildfire_burn_inferno";
  g.position.set(ox, 0, oz);
  g.userData.infernoIntensity = Iraw;

  meadowRoot.add(g);

  const lamp = new THREE.PointLight(0xff7430, 6.35 * lampLightMul, MEADOW_SIDE_METERS * (2.2 + Ieff * 0.92), 1.93);
  lamp.decay = 2;
  lamp.position.set(0, Math.max(MEADOW_SIDE_METERS * 0.06, burntRadiusMetres * (0.94 + Ieff * 0.18)), 0);
  g.add(lamp);

  /** Low fill so trunks / grass read against ember light (scaled vs severity). */
  const fillLamp = new THREE.PointLight(
    0xff3a12,
    2.35 * THREE.MathUtils.clamp(lampLightMul * 1.02, 0.22, 1.06),
    burntRadiusMetres * (9.8 + Ieff * 4.2),
    2.1,
  );
  fillLamp.decay = 2;
  fillLamp.position.set(0, Math.max(0.72, burntRadiusMetres * (0.28 + Ieff * 0.22)), 0);
  g.add(fillLamp);

  const _tmpC0 = new THREE.Color();
  const _tmpC1 = new THREE.Color();

  function bakeBillow(which) {
    const s = which === "smoke_wisp" ? 112 : 96;
    const canvas = document.createElement("canvas");
    canvas.width = s;
    canvas.height = s;
    const cx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    if (!cx) {
      tex.needsUpdate = true;
      return tex;
    }
    cx.clearRect(0, 0, s, s);
    if (which === "smoke_wisp") {
      for (let k = 0; k < 7; k++) {
        const gx = s * (0.22 + Math.random() * 0.56);
        const gy = s * (0.22 + Math.random() * 0.56);
        const gr = s * (0.07 + Math.random() * 0.22);
        const grad = cx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        grad.addColorStop(0, "rgba(245,240,233,0.42)");
        grad.addColorStop(0.45, "rgba(130,125,120,0.18)");
        grad.addColorStop(1, "rgba(40,38,40,0)");
        cx.fillStyle = grad;
        cx.beginPath();
        cx.arc(gx, gy, gr, 0, Math.PI * 2);
        cx.fill();
      }
    } else {
      const g0 = cx.createRadialGradient(s * 0.5, s * 0.52, s * 0.02, s * 0.5, s * 0.52, s * 0.44);
      if (which === "flare") {
        g0.addColorStop(0, "rgba(255,255,255,0.92)");
        g0.addColorStop(0.16, "rgba(255,235,215,0.78)");
        g0.addColorStop(0.45, "rgba(255,150,74,0.38)");
        g0.addColorStop(0.75, "rgba(200,60,18,0.12)");
        g0.addColorStop(1, "rgba(120,38,14,0)");
      } else if (which === "flare_core") {
        g0.addColorStop(0, "rgba(255,255,255,0.98)");
        g0.addColorStop(0.12, "rgba(255,248,220,0.85)");
        g0.addColorStop(0.38, "rgba(255,200,120,0.35)");
        g0.addColorStop(0.72, "rgba(255,110,48,0.08)");
        g0.addColorStop(1, "rgba(160,42,14,0)");
      } else if (which === "spark") {
        g0.addColorStop(0, "rgba(255,255,255,1)");
        g0.addColorStop(0.18, "rgba(255,236,190,0.95)");
        g0.addColorStop(0.55, "rgba(255,170,96,0.35)");
        g0.addColorStop(1, "rgba(255,120,60,0)");
      } else {
        g0.addColorStop(0, "rgba(240,237,231,0.38)");
        g0.addColorStop(0.32, "rgba(120,115,112,0.22)");
        g0.addColorStop(0.68, "rgba(60,58,58,0.1)");
        g0.addColorStop(1, "rgba(42,41,43,0)");
      }
      cx.fillStyle = g0;
      cx.fillRect(0, 0, s, s);
    }
    tex.needsUpdate = true;
    return tex;
  }

  function bakeGroundHeatMap() {
    const s = 128;
    const canvas = document.createElement("canvas");
    canvas.width = s;
    canvas.height = s;
    const cx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (!cx) {
      tex.needsUpdate = true;
      return tex;
    }
    const rad = cx.createRadialGradient(s * 0.5, s * 0.5, 0, s * 0.5, s * 0.5, s * 0.49);
    rad.addColorStop(0, "rgba(255,200,96,0.55)");
    rad.addColorStop(0.22, "rgba(255,88,34,0.38)");
    rad.addColorStop(0.48, "rgba(200,42,18,0.2)");
    rad.addColorStop(0.74, "rgba(60,28,18,0.08)");
    rad.addColorStop(1, "rgba(18,12,10,0)");
    cx.fillStyle = rad;
    cx.fillRect(0, 0, s, s);
    tex.needsUpdate = true;
    return tex;
  }

  const flareMap = bakeBillow("flare");
  const flareCoreMap = bakeBillow("flare_core");
  const smokeMap = bakeBillow("smoke");
  const smokeWispMap = bakeBillow("smoke_wisp");
  const sparkMap = bakeBillow("spark");
  const groundHeatMap = bakeGroundHeatMap();

  const groundHeat = new THREE.Mesh(
    new THREE.CircleGeometry(burntRadiusMetres * 3.35 * footMul, 72),
    new THREE.MeshBasicMaterial({
      map: groundHeatMap,
      transparent: true,
      opacity: THREE.MathUtils.clamp(0.72 * opMul + Ieff * 0.06, 0.12, 0.88),
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  groundHeat.name = "burn_ground_heat";
  groundHeat.rotation.x = -Math.PI * 0.5;
  groundHeat.position.y = 0.035;
  groundHeat.renderOrder = -6;
  g.add(groundHeat);

  const charDisc = new THREE.Mesh(
    new THREE.CircleGeometry(burntRadiusMetres * 2.05 * footMul, 56),
    new THREE.MeshBasicMaterial({
      color: 0x1c1410,
      transparent: true,
      opacity: THREE.MathUtils.clamp(0.42 * opMul, 0.08, 0.52),
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  charDisc.name = "burn_char_ring";
  charDisc.rotation.x = -Math.PI * 0.5;
  charDisc.position.y = 0.02;
  charDisc.renderOrder = -5;
  g.add(charDisc);

  /**
   * @typedef {{ step: (dt:number, driftX:number, driftZ:number) => void }} BurnLayerRunner
   */

  /** @returns {BurnLayerRunner} */
  function spawnLayer(n, tex, conf) {
    const {
      radialMul,
      minY,
      spreadY,
      capY,
      rise,
      sway,
      size,
      additive,
      colorHex,
      opacity,
      renderOrder,
      name,
      toneMapped,
      liftJitter = 0,
      turbAmp = 0,
      turbHz = 5.8,
      windMul = 1,
      varyColorHex,
    } = conf;

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const swirl = new Float32Array(n);
    const liftMul = new Float32Array(n);
    /** @type {Float32Array | null} */
    let colAttr = null;
    const radialLimit = burntRadiusMetres * radialMul;

    const reposition = (ix) => {
      const i3 = ix * 3;
      const rr = Math.sqrt(Math.random()) * radialLimit;
      const th = Math.random() * Math.PI * 2;
      pos[i3] = Math.cos(th) * rr;
      pos[i3 + 2] = Math.sin(th) * rr;
      pos[i3 + 1] = minY + Math.random() * spreadY;
      swirl[ix] = Math.random() * Math.PI * 2;
      liftMul[ix] = 1 + (Math.random() * 2 - 1) * liftJitter;
      if (colAttr) {
        _tmpC0.setHex(colorHex);
        _tmpC1.setHex(/** @type {number} */ (varyColorHex));
        _tmpC0.lerp(_tmpC1, Math.random() * 0.92);
        colAttr[i3] = _tmpC0.r;
        colAttr[i3 + 1] = _tmpC0.g;
        colAttr[i3 + 2] = _tmpC0.b;
      }
    };

    for (let ix = 0; ix < n; ix++) reposition(ix);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (varyColorHex != null) {
      colAttr = new Float32Array(n * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colAttr, 3));
      for (let ix = 0; ix < n; ix++) {
        const i3 = ix * 3;
        _tmpC0.setHex(colorHex);
        _tmpC1.setHex(varyColorHex);
        _tmpC0.lerp(_tmpC1, Math.random() * 0.92);
        colAttr[i3] = _tmpC0.r;
        colAttr[i3 + 1] = _tmpC0.g;
        colAttr[i3 + 2] = _tmpC0.b;
      }
    }

    const mat = new THREE.PointsMaterial({
      map: tex,
      /** Vertex lerps carry hue when varyColorHex is used. */
      color: varyColorHex != null ? 0xffffff : colorHex,
      opacity,
      size,
      transparent: true,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
      fog: true,
      toneMapped: toneMapped !== false && !additive,
      vertexColors: varyColorHex != null,
    });

    const pts = new THREE.Points(geo, mat);
    pts.name = name;
    pts.frustumCulled = false;
    pts.renderOrder = renderOrder;
    g.add(pts);

    return {
      step(dt, driftX, driftZ) {
        const wPhase = grassWindTimeUniform.value;
        const wx = driftX * windMul * dt;
        const wz = driftZ * windMul * dt;
        for (let ix = 0; ix < n; ix++) {
          const i3 = ix * 3;
          const lift =
            rise *
            dt *
            liftMul[ix] *
            (1 + 0.095 * Math.sin(wPhase * 8.95 + swirl[ix]) + 0.05 * Math.sin(wPhase * 17.3 + ix * 0.31));
          pos[i3 + 1] += lift;
          pos[i3] += wx * sway;
          pos[i3 + 2] += wz * sway;
          if (turbAmp > 0) {
            const tp = wPhase * turbHz + swirl[ix] * 4.17 + ix * 0.051;
            const tu = turbAmp * dt * (0.85 + 0.15 * Math.sin(wPhase * 2.2 + ix));
            pos[i3] += Math.sin(tp) * tu;
            pos[i3 + 2] += Math.cos(tp * 0.88) * tu;
            pos[i3 + 1] += Math.sin(tp * 0.37) * tu * 0.22;
          }
          const dist = Math.hypot(pos[i3], pos[i3 + 2]);
          if (pos[i3 + 1] > capY || dist > radialLimit * 1.08) reposition(ix);
        }
        geo.attributes.position.needsUpdate = true;
        if (colAttr) geo.attributes.color.needsUpdate = true;
      },
    };
  }

  /** Draw smoke before bright embers — additive passes last. */
  const layers = [
    spawnLayer(nSmoke(720), smokeMap, {
      radialMul: 1.32,
      minY: 0,
      spreadY: 48,
      capY: MEADOW_SIDE_METERS * 0.98,
      rise: 28 * riseMul,
      sway: 0.58,
      size: Math.min(68, burntRadiusMetres * 2.18) * sizeMul,
      additive: false,
      colorHex: 0x5d5756,
      opacity: 0.22 * opMul,
      renderOrder: -4,
      name: "burn_smoke_haze",
      toneMapped: false,
      liftJitter: 0.22,
      turbAmp: 1.85 * turbMul,
      turbHz: 4.2,
    }),
    spawnLayer(nSmoke(420), smokeWispMap, {
      radialMul: 1.18,
      minY: 1,
      spreadY: 36,
      capY: MEADOW_SIDE_METERS * 0.86,
      rise: 22 * riseMul,
      sway: 0.52,
      size: Math.min(88, burntRadiusMetres * 2.75) * sizeMul,
      additive: false,
      colorHex: 0x4a4542,
      opacity: 0.135 * opMul,
      renderOrder: -3,
      name: "burn_smoke_wisp",
      toneMapped: false,
      liftJitter: 0.35,
      turbAmp: 2.65 * turbMul,
      turbHz: 3.4,
    }),
    spawnLayer(nSmoke(280), smokeMap, {
      radialMul: 1.2,
      minY: 2,
      spreadY: 62,
      capY: MEADOW_SIDE_METERS * 0.8,
      rise: 44 * riseMul,
      sway: 0.5,
      size: Math.min(102, burntRadiusMetres * 3.28) * sizeMul,
      additive: false,
      colorHex: 0x2e2c2a,
      opacity: 0.1 * opMul,
      renderOrder: -2,
      name: "burn_smoke_thick",
      toneMapped: false,
      liftJitter: 0.18,
      turbAmp: 1.2 * turbMul,
      turbHz: 2.8,
    }),
    spawnLayer(nFlame(420), flareMap, {
      radialMul: 0.96,
      minY: 0,
      spreadY: 22,
      capY: burntRadiusMetres * 3.65,
      rise: 58 * riseMul,
      sway: 0.16,
      size: Math.min(18, burntRadiusMetres * 1.02) * sizeMul,
      additive: false,
      colorHex: 0xffd4a8,
      opacity: 0.26 * opMul,
      renderOrder: 0,
      name: "burn_flame_sheet",
      toneMapped: false,
      liftJitter: 0.28,
      turbAmp: 0.95 * turbMul,
      turbHz: 9.5,
      varyColorHex: 0xff8428,
    }),
    spawnLayer(nFlame(520), flareMap, {
      radialMul: 1,
      minY: 0,
      spreadY: 8,
      capY: burntRadiusMetres * 2.72,
      rise: 78 * riseMul,
      sway: 0.13,
      size: Math.min(13, burntRadiusMetres * 0.68) * sizeMul,
      additive: false,
      colorHex: 0xff9646,
      opacity: 0.2 * opMul,
      renderOrder: 1,
      name: "burn_flame_near",
      toneMapped: false,
      liftJitter: 0.2,
      turbAmp: 0.72 * turbMul,
      turbHz: 11.2,
      varyColorHex: 0xff5a1c,
    }),
    spawnLayer(nFlame(220), flareCoreMap, {
      radialMul: 0.72,
      minY: 0,
      spreadY: 4,
      capY: burntRadiusMetres * 1.55,
      rise: 62 * riseMul,
      sway: 0.08,
      size: Math.min(7.2, burntRadiusMetres * 0.36) * sizeMul,
      additive: true,
      colorHex: 0xffeecc,
      opacity: 0.88 * opMul,
      renderOrder: 3,
      name: "burn_flame_core",
      toneMapped: false,
      liftJitter: 0.15,
      turbAmp: 0.45 * turbMul,
      turbHz: 14.5,
      varyColorHex: 0xffa040,
    }),
    spawnLayer(nFlame(680), flareMap, {
      radialMul: 1,
      minY: 0,
      spreadY: 5,
      capY: burntRadiusMetres * 2.25,
      rise: 92 * riseMul,
      sway: 0.07,
      size: Math.min(8.8, burntRadiusMetres * 0.48) * sizeMul,
      additive: true,
      colorHex: 0xff7a42,
      opacity: 0.78 * opMul,
      renderOrder: 4,
      name: "burn_ember_burst",
      toneMapped: false,
      liftJitter: 0.32,
      turbAmp: 0.55 * turbMul,
      turbHz: 12.8,
      varyColorHex: 0xff3400,
    }),
    spawnLayer(nFlame(400), flareCoreMap, {
      radialMul: 0.88,
      minY: 0,
      spreadY: 3,
      capY: burntRadiusMetres * 1.12,
      rise: 74 * riseMul,
      sway: 0.06,
      size: Math.min(5.2, burntRadiusMetres * 0.32) * sizeMul,
      additive: true,
      colorHex: 0xfff6e8,
      opacity: 0.9 * opMul,
      renderOrder: 5,
      name: "burn_ember_hot",
      toneMapped: false,
      liftJitter: 0.12,
      turbAmp: 0.35 * turbMul,
      turbHz: 16.2,
      varyColorHex: 0xffc878,
    }),
    spawnLayer(nFlame(320), sparkMap, {
      radialMul: 0.92,
      minY: 0.25,
      spreadY: 4,
      capY: burntRadiusMetres * 8.25,
      rise: 118 * riseMul,
      sway: 0.22,
      size: Math.min(3.8, burntRadiusMetres * 0.26) * sizeMul,
      additive: true,
      colorHex: 0xfff2c4,
      opacity: 0.95 * opMul,
      renderOrder: 6,
      name: "burn_sparks",
      toneMapped: false,
      liftJitter: 0.55,
      turbAmp: 1.95 * turbMul,
      turbHz: 18.7,
      varyColorHex: 0xff9040,
    }),
    spawnLayer(nSmoke(260), smokeMap, {
      radialMul: 1.45,
      minY: 0,
      spreadY: burntRadiusMetres * 2.85,
      capY: MEADOW_SIDE_METERS * 0.42,
      rise: 7 * riseMul,
      sway: 0.72,
      size: Math.min(4.8, burntRadiusMetres * 0.52) * sizeMul,
      additive: false,
      colorHex: 0x716b66,
      opacity: 0.16 * opMul,
      renderOrder: -1,
      name: "burn_ash_near",
      toneMapped: false,
      liftJitter: 0.4,
      turbAmp: 2.35 * turbMul,
      turbHz: 2.05,
      windMul: 1.65,
      varyColorHex: 0x908a84,
    }),
  ];

  let infernoPrevElapsed = NaN;

  const lampMainBaseline = 6.35 * lampLightMul;
  const fillMainBaseline = fillLamp.intensity;
  const ghPulseBase = THREE.MathUtils.clamp(0.62 * opMul + Ieff * 0.05, 0.06, 0.8);
  const chPulseBase = THREE.MathUtils.clamp(0.38 * opMul + Ieff * 0.04, 0.05, 0.5);

  return (elapsed) => {
    const dt = Number.isFinite(infernoPrevElapsed)
      ? Math.min(Math.max(elapsed - infernoPrevElapsed, 1e-4), 1 / 18)
      : 1 / 55;
    infernoPrevElapsed = elapsed;
    const w = grassWindTimeUniform.value;
    const driftX = Math.sin(w * 4.05 + burntRadiusMetres * 0.058) * 12.5;
    const driftZ = Math.cos(w * 3.07 + burntRadiusMetres * 0.034) * 11.2;

    const flick =
      flickAmpOverall *
      (Math.sin(elapsed * 18.62 + phaseOff) * 1.94 +
        Math.sin(elapsed * 47.1 + phaseOff * 0.71) * 0.95 +
        Math.sin(elapsed * 11.82 + phaseOff * 1.09) * 0.72 +
        Math.sin(elapsed * 63.4 + phaseOff * 0.44) * 0.41);

    lamp.intensity = lampMainBaseline + flick;
    fillLamp.intensity =
      fillMainBaseline + flick * 0.22 + Math.sin(elapsed * 29.8 + phaseOff) * 0.35 * flickAmpOverall;

    _tmpC0.setHSL(
      0.057 + Math.sin(elapsed * 44.2 + phaseOff * 1.07) * 0.012,
      0.94,
      0.48 + Math.sin(elapsed * 31.1 + phaseOff * 0.83) * 0.07,
    );
    lamp.color.copy(_tmpC0);
    _tmpC1.setHSL(
      0.03 + Math.sin(elapsed * 52.8 + phaseOff * 0.62) * 0.018,
      1,
      0.42 + Math.sin(elapsed * 19.4 + phaseOff * 1.31) * 0.05,
    );
    fillLamp.color.copy(_tmpC1);

    /** @type {THREE.MeshBasicMaterial} */
    const ghMat = groundHeat.material;
    ghMat.opacity =
      ghPulseBase +
      flickAmpOverall * (Math.sin(elapsed * 21.7 + phaseOff) * 0.08) +
      Math.sin(elapsed * 53.4 + phaseOff * 0.5) * 0.04 * flickAmpOverall +
      Math.sin(elapsed * 71.2 + phaseOff * 0.37) * 0.025 * flickAmpOverall;

    /** @type {THREE.MeshBasicMaterial} */
    const chMat = charDisc.material;
    chMat.opacity = chPulseBase + flickAmpOverall * Math.sin(elapsed * 14.2 + phaseOff * 1.05) * 0.05;

    for (let li = 0; li < layers.length; li++) layers[li].step(dt, driftX, driftZ);
  };
}

/**
 * Registers one inferno patch per zone; aggregates {@link meadowRoot}.userData.tickWildfireBurn.
 */
function attachWildfireBurnZonesFromConfig(meadowRoot) {
  const zones = WILDFIRE_BURN_ZONES;
  if (!zones.length) {
    meadowRoot.userData.tickWildfireBurn = () => {};
    return;
  }
  /** @type {{ tick: (elapsed:number)=>void, hero: boolean }[]} */
  const ticks = [];
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    const iq = THREE.MathUtils.clamp(z.intensity ?? 1, 0.015, 1.55);
    // Small distant spot fires don't deserve a hero-zone particle budget — they
    // dominate the per-frame point cloud cost. Hero zones (≥0.30 intensity)
    // stay full-fidelity.
    const hero = iq >= 0.3;
    const particleMul = hero ? 1 : 0.35;
    ticks.push({
      tick: attachWildfireBurnInferno(meadowRoot, z.ox, z.oz, z.radiusMeters, {
        intensity: iq,
        zoneIndex: zi,
        particleMul,
      }),
      hero,
    });
  }

  // Non-hero spot fires only get a particle/light update every other frame; the
  // inferno tick computes its own `dt`, so motion stays correct at half rate.
  let burnFrame = 0;
  meadowRoot.userData.tickWildfireBurn =
    ticks.length <= 1
      ? ticks[0]?.tick ?? ((_elapsed) => {})
      : (elapsed) => {
          const tickSpot = (burnFrame++ & 1) === 0;
          for (let ti = 0; ti < ticks.length; ti++) {
            const t = ticks[ti];
            if (t.hero || tickSpot) t.tick(elapsed);
          }
        };
}

function isNearBlocked(x, z, blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r) return true;
  }
  return false;
}

/** Sets diffuse map anisotropy on mesh descendants (meadow foliage + ez-tree atlases benefit). */
function applyForestTexAniso(object3d, anisoCeil) {
  const cap = Math.max(0, anisoCeil);
  object3d.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < mats.length; i++) {
      const map = mats[i]?.map;
      if (map) map.anisotropy = cap;
    }
  });
}

function sampleFieldXZ(half, rnd, blocks) {
  const limSquare = Math.min(half * 1.022, MEADOW_HALF_METERS * 0.996);
  for (let attempt = 0; attempt < 26; attempt++) {
    const x = (rnd() * 2 - 1) * limSquare;
    const z = (rnd() * 2 - 1) * limSquare;
    if (!isNearBlocked(x, z, blocks)) return { x, z };
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const radial = rnd() < 0.62 ? 0.22 + rnd() * 0.72 : 0.48 + rnd() * 0.52;
    const ang = rnd() * Math.PI * 2;
    const x = Math.cos(ang) * half * radial;
    const z = Math.sin(ang) * half * radial;
    if (!isNearBlocked(x, z, blocks)) return { x, z };
  }
  const ang = rnd() * Math.PI * 2;
  const radial = rnd() * 0.45;
  return { x: Math.cos(ang) * half * radial, z: Math.sin(ang) * half * radial };
}

/**
 * @typedef {{
 *   maxMapAniso?: number,
 *   onTreeMountComplete?: () => void,
 *   onTreeMountProgress?: (mounted: number, total: number) => void,
 *   shouldAbort?: () => boolean,
 * }} WildfireMeadowStreamHooks
 */

/**
 * @param {WildfireMeadowStreamHooks} [streamHooks]
 * @returns {{ root: THREE.Group; trees: Tree[] }}
 */
export function createWildfireMeadowRoot(streamHooks) {
  const root = new THREE.Group();
  root.name = "wildfire_ez_forest";

  const planeSize = MEADOW_SIDE_METERS;
  const groundGeo = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);

  const dirtTextures = createWildfireDirtGroundTextures();
  const dirtRepeats = Math.max(18, planeSize * 0.22);
  dirtTextures.map.repeat.set(dirtRepeats, dirtRepeats);
  dirtTextures.roughnessMap.repeat.set(dirtRepeats, dirtRepeats);
  dirtTextures.normalMap.repeat.set(dirtRepeats, dirtRepeats);

  const groundMat = new THREE.MeshStandardMaterial({
    map: dirtTextures.map,
    roughnessMap: dirtTextures.roughnessMap,
    roughness: 1,
    metalness: 0,
    normalMap: dirtTextures.normalMap,
    normalScale: new THREE.Vector2(0.52, -0.52),
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = false;
  root.add(ground);

  if (TREE_DENSITY_TARGET > EFFECTIVE_TREE_COUNT) {
    console.warn(
      `[wildfire-meadow] EZ-Tree instances capped at ${EFFECTIVE_TREE_COUNT} (density target ρ≈ ${TREE_DENSITY_TARGET}). Raise EZ_TREE_INSTANCE_CAP for denser crowns (heavy), or bake/LOD trees.`,
    );
  }

  const half = MEADOW_HALF_METERS;
  const rnd = () => Math.random();

  /** Wider crowns when meshes are capped below ρ target — purely visual fudge. */
  const treeCrownsScaleAmp =
    TREE_DENSITY_TARGET > EFFECTIVE_TREE_COUNT
      ? Math.min(2.45, TREE_DENSITY_TARGET / Math.max(1, EFFECTIVE_TREE_COUNT))
      : 1;

  const treeBlocks = [];
  /** @type {{ presetName: string; seed: number; x: number; z: number; scale: number; rotY: number }[]} */
  const treePlacements = [];

  const treeInset = half * 0.988;

  const burnZones = WILDFIRE_BURN_ZONES;

  for (let i = 0; i < EFFECTIVE_TREE_COUNT; i++) {
    const presetName = FOREST_PRESETS[i % FOREST_PRESETS.length];

    /** Fire-line crown concentration — remainder stays uniform meadow. */
    let x;
    let z;
    const clusterTrial = fractBias01(i + 881, 731.913);
    if (clusterTrial < WILDFIRE_BURN_CLUSTER_TREE_BIAS && burnZones.length > 0) {
      let settled = false;
      const zn = burnZones[weightedBurnZoneIndex(i, burnZones, i * 791.913 + 881)];
      for (let t = 0; t < 19; t++) {
        const ang = rnd() * Math.PI * 2;
        const radial = Math.sqrt(rnd()) * zn.radiusMeters * (0.62 + rnd() * 0.38);
        const tx = zn.ox + Math.cos(ang) * radial;
        const tz = zn.oz + Math.sin(ang) * radial;
        if (Math.abs(tx) <= treeInset && Math.abs(tz) <= treeInset) {
          x = tx;
          z = tz;
          settled = true;
          break;
        }
      }
      if (!settled) {
        x = (rnd() * 2 - 1) * treeInset;
        z = (rnd() * 2 - 1) * treeInset;
      }
    } else {
      x = (rnd() * 2 - 1) * treeInset;
      z = (rnd() * 2 - 1) * treeInset;
    }

    const scale =
      (presetName.includes("Pine") ? 0.048 + rnd() * 0.028 : 0.055 + rnd() * 0.038) *
      treeCrownsScaleAmp;
    const seed = ((TreePreset[presetName]?.seed ?? 30895) + i * 104729 + Math.floor(rnd() * 10000)) >>> 0;
    treePlacements.push({
      presetName,
      seed,
      x,
      z,
      scale,
      rotY: rnd() * Math.PI * 2,
    });
    treeBlocks.push({ x, z, r: Math.max(1.15, scale * 26) });
  }

  const grassTex = createGrassTuftTexture();
  const grassGeo = createGrassTuftCrossGeometry();
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    transparent: true,
    alphaTest: 0.2,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0,
    depthWrite: true,
  });

  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassWindTimeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
      float gust = sin(transformed.x * 2.8 + uTime * 1.9) * cos(transformed.z * 2.3 + uTime * 1.4);
      float h = max(0.0, uv.y);
      transformed.xz += gust * 0.042 * h * h;
      transformed.x += cos(uTime * 1.1 + transformed.z * 1.7) * 0.021 * h * h;
      `,
      );
  };

  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_TUFT_COUNT);
  /** Large spread instances: default bounds can prune the whole meadow. */
  grassMesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0);

  for (let i = 0; i < GRASS_TUFT_COUNT; i++) {
    const { x, z } = sampleFieldXZ(half, rnd, treeBlocks);
    const sy = 0.62 + rnd() * 1.12;
    const sxz = 0.82 + rnd() * 0.56;
    euler.set((rnd() - 0.5) * 0.16, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12);
    q.setFromEuler(euler);
    s.set(sxz, sy, sxz);
    p.set(x, 0, z);
    m.compose(p, q, s);
    grassMesh.setMatrixAt(i, m);
  }
  grassMesh.instanceMatrix.needsUpdate = true;

  root.add(grassMesh);

  const flowerTex = createFlowerSpriteTexture();
  const flowerGeo = new THREE.PlaneGeometry(0.2, 0.2);
  flowerGeo.translate(0, 0.1, 0);
  const flowerMat = new THREE.MeshBasicMaterial({
    map: flowerTex,
    transparent: true,
    alphaTest: 0.15,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,
    depthWrite: false,
    vertexColors: true,
  });

  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWER_COUNT);
  flowerMesh.frustumCulled = false;
  const flowerColors = [
    new THREE.Color(0xd896ff),
    new THREE.Color(0xfff176),
    new THREE.Color(0xffffff),
    new THREE.Color(0xc77dff),
    new THREE.Color(0xffe082),
  ];

  for (let i = 0; i < FLOWER_COUNT; i++) {
    const { x, z } = sampleFieldXZ(half, rnd, treeBlocks);
    euler.set(0, rnd() * Math.PI * 2, 0);
    q.setFromEuler(euler);
    const fs = 0.65 + rnd() * 1.2;
    s.set(fs, fs, fs);
    p.set(x, 0.03 + rnd() * 0.06, z);
    m.compose(p, q, s);
    flowerMesh.setMatrixAt(i, m);
    flowerMesh.setColorAt(i, flowerColors[(i + Math.floor(rnd() * 50)) % flowerColors.length]);
  }
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;

  root.add(flowerMesh);

  attachWildfireBurnZonesFromConfig(root);

  const anisoCeil = streamHooks?.maxMapAniso ?? 8;
  applyForestTexAniso(root, anisoCeil);

  /** @type {Tree[]} */
  const trees = [];
  const placements = treePlacements;
  const totalTrees = placements.length;

  const perfNow =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now.bind(performance)
      : () => Date.now();

  let mountRaf = 0;
  let placementIndex = 0;

  const cancelEzTreeMount = () => {
    if (mountRaf !== 0) cancelAnimationFrame(mountRaf);
    mountRaf = 0;
  };

  const mountTick = () => {
    mountRaf = 0;
    if (streamHooks?.shouldAbort?.()) {
      delete root.userData.cancelWildfireEzTreeMount;
      return;
    }

    const t0 = perfNow();
    let nThisSlice = 0;

    while (
      placementIndex < totalTrees &&
      nThisSlice < EZ_TREE_STREAM_MAX_PER_TICK &&
      perfNow() - t0 < EZ_TREE_STREAM_MS_PER_FRAME
    ) {
      const pl = placements[placementIndex];
      placementIndex++;

      const opts = optionsFromPreset(pl.presetName);
      opts.seed = pl.seed;

      const tree = new Tree();
      tree.loadFromJson(opts);

      tree.position.set(pl.x, 0, pl.z);
      tree.rotation.y = pl.rotY;
      tree.scale.setScalar(pl.scale);

      root.add(tree);
      trees.push(tree);
      applyForestTexAniso(tree, anisoCeil);
      nThisSlice++;

      streamHooks?.onTreeMountProgress?.(trees.length, totalTrees);
    }

    if (streamHooks?.shouldAbort?.()) {
      cancelEzTreeMount();
      delete root.userData.cancelWildfireEzTreeMount;
      return;
    }

    if (placementIndex >= totalTrees) {
      delete root.userData.cancelWildfireEzTreeMount;
      streamHooks?.onTreeMountComplete?.();
      return;
    }

    mountRaf = requestAnimationFrame(mountTick);
  };

  root.userData.cancelWildfireEzTreeMount = cancelEzTreeMount;
  mountRaf = requestAnimationFrame(mountTick);

  return { root, trees };
}
