/**
 * Industrial preset: bundled GLB theatre mesh (orbit preview).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PRESET_VISUAL, setCurrentScenePreset } from "../../config/presets.js";
import {
  ui3d,
  povs,
  buildAgentSelector,
  teardownAgentSelector,
  currentTargetFor,
  currentTargetIdFor,
} from "./tactical-pov-shell.js";
import { buildingAvoidanceRects as urbanQuakeBuildingAvoidanceRects } from "./urban-quake.js";
import { createAgentMesh } from "./fleet-agents-mesh.js";
import {
  lerpAngleDeg,
  tacticalFpvAltitudeUrbanUnits,
  tacticalFpvEyeWorldPosition,
  tacticalFpvForwardVector,
  tacticalFpvHudAltIndustrialRelative,
  tacticalFpvLookDistanceWorld,
  tacticalFpvPhaseSeed,
} from "./fleet-fpv-kit.js";
import { emitToast } from "../../ui/toast.js";
import {
  INDUSTRIAL_SCENE_PATH,
  resolveIndustrialSceneGltfUrl,
} from "../../config/industrial-scene-asset.js";

/** @deprecated Use `INDUSTRIAL_SCENE_PATH` from `industrial-scene-asset.js`. */
export const LOCAL_INDUSTRIAL_GLTF_PATH = INDUSTRIAL_SCENE_PATH;

/**
 * Compress facility along Y (< 1 shortens height). Bottom of bbox stays fixed in world Y.
 */
const INDUSTRIAL_FACILITY_SCALE_Y = 1;

/** Extra lift (+) / sink (−) after scale, world units. */
const INDUSTRIAL_FACILITY_OFFSET_Y = 0;

/**
 * World Y of the visible cement slab — paste from height calibration (Shift+click).
 * `null` disables the procedural cement plane.
 */
const INDUSTRIAL_CEMENT_GROUND_WORLD_Y = -2310.326;

/** Cement texture repeat scale in world units (larger = finer). */
const INDUSTRIAL_CEMENT_TILE_WORLD = 8;

/** Plane edge length ∝ facility xz extent × mult (then clamped). Larger = wider slab. */
const INDUSTRIAL_CEMENT_PLANE_HORIZ_MULT = 42;

const INDUSTRIAL_CEMENT_PLANE_MIN = 7200;
const INDUSTRIAL_CEMENT_PLANE_MAX = 36000;

/** Albedo maps are authored near this grey-brown (#79746D); keep material white to avoid double tint. */
const INDUSTRIAL_CEMENT_GROUND_COLOR = 0xffffff;

/** Bump strength — aggregate / pour irregularity (flat slab, no displacement). */
const INDUSTRIAL_CEMENT_BUMP_SCALE = 0.88;

/** Procedural map pixel density. */
const INDUSTRIAL_CEMENT_TEX_SIZE = 512;

/** RGB baseline for poured concrete ≈ #79746D. */
const INDUSTRIAL_CEMENT_BASE_RGB = { r: 121, g: 116, b: 109 };

let indScene = null;
/** @type {THREE.WebGLRenderer | null} */
let indRenderer = null;
/** @type {THREE.PerspectiveCamera | null} */
let indCamera = null;
/** @type {OrbitControls | null} */
let indControls = null;
/** @type {ResizeObserver | null} */
let indResizeObserver = null;
/** @type {number | null} */
let indRafId = null;
let indBootGeneration = 0;

/** PMREM cube env from RoomEnvironment — dispose on teardown. */
/** @type {THREE.WebGLCubeRenderTarget | null} */
let indEnvTarget = null;

/** Loaded GLB root — raycast target for height calibration. */
/** @type {THREE.Object3D | null} */
let indFacilityRoot = null;

const indHeightRaycaster = new THREE.Raycaster();
const indPointerNdc = new THREE.Vector2();

/** @type {AbortController | null} */
let indHeightCalibAbort = null;

/** @type {HTMLDivElement | null} */
let indHeightHudEl = null;

/** @type {THREE.Mesh | null} */
let indCementGround = null;

/** Full-window `industrial-preview.html` uses internal RAF; mission POVs use `povs` + `update3D`. */
let indStandaloneActive = false;

/** @type {THREE.PointLight | null} */
let indRimLight = null;

/** Wrapper groups per agent — scaled to facility grid (urban meshes assume ~1-unit cells). */
const industrialAgentHolders = new Map();

let industrialGridCols = 1;
let industrialGridRows = 1;
let industrialXMin = 0;
let industrialXMax = 1;
let industrialZMin = 0;
let industrialZMax = 1;
let industrialCellSpan = 1;
let industrialGroundY = 0;

function setIndustrialGridMappingFromFacility(root, scenario, cementY) {
  const box = new THREE.Box3().setFromObject(root);
  industrialXMin = box.min.x;
  industrialXMax = box.max.x;
  industrialZMin = box.min.z;
  industrialZMax = box.max.z;
  const [cols, rows] = scenario.map.size;
  industrialGridCols = Math.max(1, cols);
  industrialGridRows = Math.max(1, rows);
  industrialCellSpan = Math.min(
    (industrialXMax - industrialXMin) / industrialGridCols,
    (industrialZMax - industrialZMin) / industrialGridRows
  );
  industrialGroundY =
    cementY != null && Number.isFinite(cementY)
      ? cementY + industrialCellSpan * 0.055
      : box.max.y + industrialCellSpan * 0.045;
}

/** Same cell indices as the 2D tactical map → world XZ over the GLB footprint (v flipped to match canvas vs top-down Z). */
function industrialGridToWorldXZ(ix, iy) {
  const u = (ix + 0.5) / industrialGridCols;
  const v = (iy + 0.5) / industrialGridRows;
  const x = industrialXMin + u * (industrialXMax - industrialXMin);
  const z = industrialZMax - v * (industrialZMax - industrialZMin);
  return { x, z };
}

function buildIndustrialAgentMeshes(scenario) {
  industrialAgentHolders.clear();
  if (!indScene || !scenario?.agents?.length) return;

  const scaleUniform = Math.max(18, industrialCellSpan * 0.52);

  for (const a of scenario.agents) {
    const inner = createAgentMesh(a.type);
    const holder = new THREE.Group();
    holder.name = `industrial_agent_${a.id}`;
    holder.add(inner);
    holder.scale.setScalar(scaleUniform);
    const { x, z } = industrialGridToWorldXZ(a.location[0], a.location[1]);
    holder.position.set(
      x,
      industrialGroundY + industrialCellSpan * tacticalFpvAltitudeUrbanUnits(a, performance.now() / 1000),
      z
    );
    indScene.add(holder);
    industrialAgentHolders.set(a.id, holder);
  }
}

function detachIndustrialHeightCalibrationUi() {
  indHeightCalibAbort?.abort();
  indHeightCalibAbort = null;
  if (indHeightHudEl) {
    indHeightHudEl.remove();
    indHeightHudEl = null;
  }
}

function teardownIndustrialHeightCalibration() {
  detachIndustrialHeightCalibrationUi();
}

/**
 * Hover: world Y at hit point + face normal “levelness”. Shift+click copies Y.
 */
function attachIndustrialHeightCalibration(canvas, povFrame, bootId) {
  detachIndustrialHeightCalibrationUi();

  indHeightCalibAbort = new AbortController();
  const { signal } = indHeightCalibAbort;

  if (getComputedStyle(povFrame).position === "static") {
    povFrame.style.position = "relative";
  }

  const hud = document.createElement("div");
  hud.className = "industrial-height-calibration-hud";
  hud.setAttribute("role", "status");
  hud.style.cssText = [
    "position:absolute",
    "right:8px",
    "bottom:8px",
    "max-width:min(320px,calc(100% - 16px))",
    "padding:8px 10px",
    "border-radius:6px",
    "font:11px/1.45 system-ui,Segoe UI,sans-serif",
    "color:#1a2332",
    "background:rgba(255,255,255,0.92)",
    "box-shadow:0 2px 10px rgba(0,0,0,0.12)",
    "pointer-events:none",
    "white-space:pre-wrap",
    "z-index:5",
  ].join(";");
  hud.textContent = "高度标定：悬停 mesh 读取 Y（世界坐标）\nShift+点击复制 Y";
  povFrame.appendChild(hud);
  indHeightHudEl = hud;

  /** @param {PointerEvent} ev */
  function pickIndustrial(ev) {
    if (!indFacilityRoot || !indCamera || bootId !== indBootGeneration) return null;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    indPointerNdc.x = ((ev.clientX - rect.left) / w) * 2 - 1;
    indPointerNdc.y = -((ev.clientY - rect.top) / h) * 2 + 1;
    indHeightRaycaster.setFromCamera(indPointerNdc, indCamera);
    const hits = indHeightRaycaster.intersectObject(indFacilityRoot, true);
    const hit = hits.find((x) => x.object?.isMesh && !x.object.userData?.industrialCementGround);
    return hit ?? null;
  }

  /** @param {PointerEvent} ev */
  function onPointerMove(ev) {
    if (bootId !== indBootGeneration || !indHeightHudEl) return;
    const hit = pickIndustrial(ev);
    if (!hit) {
      indHeightHudEl.textContent =
        "高度标定：—（未命中）\n悬停可读 Y · Shift+点击复制";
      return;
    }
    const y = hit.point.y;
    const faceN = hit.face?.normal;
    let nyStr = "—";
    if (faceN && hit.object?.matrixWorld) {
      const nw = faceN.clone().transformDirection(hit.object.matrixWorld).normalize();
      nyStr = nw.y.toFixed(3);
    }
    const meshName = hit.object?.name || "(unnamed)";
    const refY = INDUSTRIAL_CEMENT_GROUND_WORLD_Y;
    const deltaLine =
      refY != null && Number.isFinite(refY)
        ? `距水泥地 ΔY = ${(y - refY).toFixed(4)}（相对标定面）`
        : null;
    indHeightHudEl.textContent = [
      `命中高度 Y = ${y.toFixed(4)}（世界坐标）`,
      ...(deltaLine ? [deltaLine] : []),
      `朝上分量 n·Y = ${nyStr}（≈1 为水平面朝上）`,
      `物体：${meshName}`,
      "Shift+点击复制 Y",
    ].join("\n");
  }

  function onPointerLeave() {
    if (!indHeightHudEl || bootId !== indBootGeneration) return;
    indHeightHudEl.textContent =
      "高度标定：鼠标移入视图\n悬停 mesh 读取 Y · Shift+点击复制";
  }

  /** @param {PointerEvent} ev */
  function onPointerDown(ev) {
    if (!ev.shiftKey || bootId !== indBootGeneration) return;
    const hit = pickIndustrial(ev);
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    const yStr = hit.point.y.toFixed(4);
    void navigator.clipboard?.writeText(yStr).catch(() => {});
    emitToast("default", `已复制高度 Y = ${yStr}（世界坐标）`);
    console.info("[industrial height calibration]", yStr, hit.object?.name);
  }

  canvas.addEventListener("pointermove", onPointerMove, { signal });
  canvas.addEventListener("pointerleave", onPointerLeave, { signal });
  canvas.addEventListener("pointerdown", onPointerDown, { signal, capture: true });
}

function gltfAssetUrl() {
  return resolveIndustrialSceneGltfUrl();
}

/** Keeps world-space minimum Y after vertical scale (anchor bottom of bbox). */
function applyIndustrialFacilityVerticalSquash(root) {
  const sy = THREE.MathUtils.clamp(INDUSTRIAL_FACILITY_SCALE_Y, 0.05, 50);
  const oy = INDUSTRIAL_FACILITY_OFFSET_Y;
  if (Math.abs(sy - 1) < 1e-6 && oy === 0) return;

  root.updateMatrixWorld(true);
  const floorY = new THREE.Box3().setFromObject(root).min.y;

  if (Math.abs(sy - 1) >= 1e-6) {
    root.scale.y *= sy;
    root.updateMatrixWorld(true);
    root.position.y += floorY - new THREE.Box3().setFromObject(root).min.y;
  }
  root.position.y += oy;
  root.updateMatrixWorld(true);
}

function povColumnEl() {
  return document.querySelector(".map-pov-col");
}

function applyIndustrialViewportChrome() {
  const col = povColumnEl();
  if (!col) return;
  col.classList.add("industrial-glb-active");

  const kicker = col.querySelector(".vp-head .kicker");
  if (kicker) kicker.textContent = "M02 · Industrial theatre · GLB";

  const h2 = col.querySelector("[data-pov-heading]");
  if (h2) h2.textContent = "Industrial scenario · 3D mesh";

  const sub = col.querySelector("[data-pov-sub]");
  if (sub) sub.textContent = "FPV · camera follows grid motion like Urban theatre";

  const tag = col.querySelector(".vp-head .panel-tag");
  if (tag) {
    tag.textContent = "GLB";
    tag.classList.remove("warn");
    tag.classList.add("accent");
  }

  if (ui3d.povSubEl) ui3d.povSubEl.textContent = "Three.js · GLTF";
}

/**
 * @param {THREE.Material} mat
 * @param {THREE.BufferGeometry | undefined} geom
 */
function tuneIndustrialPreviewMaterial(mat, geom) {
  if (!mat) return;

  const hasVertexColors = !!geom?.attributes?.color;
  mat.side = THREE.DoubleSide;
  if (hasVertexColors && "vertexColors" in mat) mat.vertexColors = true;

  if (mat.isMeshBasicMaterial) {
    if (mat.map && "toneMapped" in mat) mat.toneMapped = false;
    mat.needsUpdate = true;
    return;
  }

  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
    const hasTex = !!(
      mat.map ||
      mat.normalMap ||
      mat.aoMap ||
      mat.emissiveMap ||
      mat.metalnessMap ||
      mat.roughnessMap
    );
    // Keep authored metal/rough when maps exist; slight floor only.
    mat.metalness = THREE.MathUtils.clamp(mat.metalness ?? 0.15, 0, 1);
    mat.roughness = THREE.MathUtils.clamp(mat.roughness ?? 0.65, 0.12, 1);
    // scene.environment needs non-zero intensity — was forcing 0 and killed PBR fill.
    if ("envMapIntensity" in mat) {
      mat.envMapIntensity = Math.max(mat.envMapIntensity ?? 1, 0.85);
    }
    if (!hasTex && mat.color) {
      const c = mat.color;
      const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
      if (lum < 0.22) c.multiplyScalar(Math.min(3.5, 0.42 / Math.max(lum, 0.04)));
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    } else if (hasTex) {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
    mat.needsUpdate = true;
    return;
  }

  mat.needsUpdate = true;
}

function fract01(n) {
  return n - Math.floor(n);
}

/** Deterministic 0–1 hash on integer lattice (inline procedural cement — no extra libs). */
function industrialHash21(ix, iy) {
  const n = Math.sin(ix * 127.123 + iy * 311.741) * 43758.5453123;
  return fract01(n);
}

function industrialValueNoise2(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const n00 = industrialHash21(x0, y0);
  const n10 = industrialHash21(x0 + 1, y0);
  const n01 = industrialHash21(x0, y0 + 1);
  const n11 = industrialHash21(x0 + 1, y0 + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(n00, n10, u),
    THREE.MathUtils.lerp(n01, n11, u),
    v
  );
}

function industrialFbm2(x, y, octaves) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * industrialValueNoise2(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Cement slab: aggregate + faint wash variation around #79746D (albedo + bump).
 */
function createIndustrialCementGroundMaps() {
  const size = INDUSTRIAL_CEMENT_TEX_SIZE;
  const canvasMap = document.createElement("canvas");
  const canvasBump = document.createElement("canvas");
  canvasMap.width = canvasBump.width = size;
  canvasMap.height = canvasBump.height = size;
  const ctxMap = canvasMap.getContext("2d");
  const ctxBump = canvasBump.getContext("2d");

  const map = new THREE.CanvasTexture(canvasMap);
  const bumpMap = new THREE.CanvasTexture(canvasBump);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  bumpMap.colorSpace = THREE.LinearSRGBColorSpace;

  if (!ctxMap || !ctxBump) {
    map.needsUpdate = true;
    bumpMap.needsUpdate = true;
    return { map, bumpMap };
  }

  const { r: BR, g: BG, b: BB } = INDUSTRIAL_CEMENT_BASE_RGB;
  const imgColor = ctxMap.createImageData(size, size);
  const imgBump = ctxBump.createImageData(size, size);
  const dC = imgColor.data;
  const dB = imgBump.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const nx = u * 140;
      const ny = v * 140;
      const wash = industrialFbm2(nx * 0.055, ny * 0.055, 3);
      const meso = industrialFbm2(nx * 0.14 + wash * 2, ny * 0.14 + wash * 2, 4);
      const fine = industrialValueNoise2(nx * 1.1, ny * 1.1);
      const grit = industrialValueNoise2(nx * 6.2, ny * 6.2);

      const fx = u * Math.PI * 2 * 9;
      const fy = v * Math.PI * 2 * 11;
      const trowel = Math.sin(fx + wash * 1.7) * Math.cos(fy - wash * 1.2) * 0.08;

      let shade = (wash - 0.5) * 22 + (meso - 0.5) * 18 + (fine - 0.5) * 14 + trowel * 18;
      shade += (grit - 0.5) * 12;

      const cx = Math.floor(u * 72);
      const cy = Math.floor(v * 72);
      const fleck = industrialHash21(cx, cy);
      if (fleck > 0.91) shade += 14 + fleck * 10;
      else if (fleck < 0.06) shade -= 10 + (1 - fleck) * 6;

      let cr = BR + shade * 0.95;
      let cg = BG + shade * 0.92;
      let cb = BB + shade * 0.88;
      cr = THREE.MathUtils.clamp(cr, 0, 255);
      cg = THREE.MathUtils.clamp(cg, 0, 255);
      cb = THREE.MathUtils.clamp(cb, 0, 255);

      let height =
        wash * 0.22 +
        meso * 0.26 +
        fine * 0.18 +
        grit * 0.14 +
        Math.sin(x * 0.09 + y * 0.07) * 0.06;
      const bump01 = THREE.MathUtils.clamp(0.52 + (height - 0.32) * 0.65, 0.12, 0.9);
      const bv = Math.round(bump01 * 255);

      const i = (y * size + x) * 4;
      dC[i] = Math.round(cr);
      dC[i + 1] = Math.round(cg);
      dC[i + 2] = Math.round(cb);
      dC[i + 3] = 255;

      dB[i] = bv;
      dB[i + 1] = bv;
      dB[i + 2] = bv;
      dB[i + 3] = 255;
    }
  }

  ctxMap.putImageData(imgColor, 0, 0);
  ctxBump.putImageData(imgBump, 0, 0);
  map.needsUpdate = true;
  bumpMap.needsUpdate = true;
  return { map, bumpMap };
}

/**
 * Infinite-feel slab at fixed world Y; xz follows orbit target; world-space UV.
 * @returns {{ mesh: THREE.Mesh; planeSize: number }}
 */
function createIndustrialCementGroundPlane(facilityRoot, yWorld) {
  const box = new THREE.Box3().setFromObject(facilityRoot);
  const center = box.getCenter(new THREE.Vector3());
  const extent = box.getSize(new THREE.Vector3());
  const maxHoriz = Math.max(extent.x, extent.z, 60);
  const planeSize = THREE.MathUtils.clamp(
    Math.max(maxHoriz * INDUSTRIAL_CEMENT_PLANE_HORIZ_MULT, INDUSTRIAL_CEMENT_PLANE_MIN),
    INDUSTRIAL_CEMENT_PLANE_MIN,
    INDUSTRIAL_CEMENT_PLANE_MAX
  );
  const tileWorld = INDUSTRIAL_CEMENT_TILE_WORLD;

  const geo = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const { map, bumpMap } = createIndustrialCementGroundMaps();
  map.repeat.set(1, 1);
  bumpMap.repeat.set(1, 1);

  const mat = new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale: INDUSTRIAL_CEMENT_BUMP_SCALE,
    color: INDUSTRIAL_CEMENT_GROUND_COLOR,
    roughness: 0.93,
    metalness: 0,
    envMapIntensity: 0.16,
    side: THREE.DoubleSide,
  });

  mat.customProgramCacheKey = () =>
    `industrial_cement_${tileWorld}_79746d_${INDUSTRIAL_CEMENT_BUMP_SCALE}_${INDUSTRIAL_CEMENT_TEX_SIZE}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCementTile = { value: tileWorld };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uCementTile;`
      )
      .replace(
        /\t#include <project_vertex>/,
        `\tvec4 cementWorldPos = modelMatrix * vec4( transformed, 1.0 );
\tvMapUv = cementWorldPos.xz / uCementTile;
#ifdef USE_BUMPMAP
\tvBumpMapUv = cementWorldPos.xz / uCementTile;
#endif
\t#include <project_vertex>`
      );
  };
  mat.needsUpdate = true;

  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "industrial_cement_ground_plane";
  mesh.userData.industrialCementGround = true;
  mesh.position.set(center.x, yWorld, center.z);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = -85;

  return { mesh, planeSize };
}

function frameCameraOnContent(camera, controls, root) {
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.78;
    camera.near = Math.max(0.01, maxDim / 2000);
    camera.far = Math.max(5000, maxDim * 40);
    camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(dist * 0.46, dist * 0.34, dist * 0.48)));
    controls.target.copy(center);
    controls.update();
    camera.lookAt(center);
    return;
  }

  camera.position.set(18, 14, 26);
  controls.target.set(0, 3, 0);
  controls.update();
}

function animateIndustrial() {
  if (!indStandaloneActive) {
    indRafId = null;
    return;
  }
  indRafId = requestAnimationFrame(animateIndustrial);
  if (!indRenderer || !indScene || !indCamera || !indControls) return;
  indControls.update();
  if (indCementGround) {
    const t = indControls.target;
    indCementGround.position.x = t.x;
    indCementGround.position.z = t.z;
  }
  indRenderer.render(indScene, indCamera);
}

/** @param {{ canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera }} entry */
function resizeIndustrialMissionPov(entry) {
  const povFrame = entry.canvas.parentElement;
  if (!povFrame || !entry.renderer || !entry.camera) return;
  const nw = Math.max(1, povFrame.clientWidth);
  const nh = Math.max(1, povFrame.clientHeight);
  entry.renderer.setSize(nw, nh, false);
  entry.camera.aspect = nw / nh;
  entry.camera.updateProjectionMatrix();
}

/**
 * Mission shell: shared `indScene`, per-column FPV camera (urban-quake semantics) + renderer.
 * @param {number} bootId
 * @param {object} scenario
 * @param {HTMLElement[]} povCols
 */
async function bootIndustrialMission(bootId, scenario, povCols) {
  indStandaloneActive = false;
  indRimLight = null;

  detachIndustrialHeightCalibrationUi();

  if (indRafId != null) {
    cancelAnimationFrame(indRafId);
    indRafId = null;
  }
  indResizeObserver?.disconnect();
  indResizeObserver = null;
  indRenderer = null;
  indCamera = null;
  indControls = null;

  const s3 = PRESET_VISUAL.industrial.scene3d;
  const refTheatreDiagonal = 42;

  /** @type {Array<object>} */
  const entries = [];

  for (let i = 0; i < (povCols?.length ?? 0); i++) {
    const col = povCols[i];
    const canvas = col.querySelector("[data-pov-canvas]");
    if (!canvas) continue;
    const povFrame = canvas.parentElement;
    if (!povFrame) continue;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (err) {
      console.warn(`Industrial POV ${i}: WebGL unavailable`, err);
      continue;
    }

    const w = Math.max(1, povFrame.clientWidth);
    const h = Math.max(1, povFrame.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(s3.rendererClear, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = s3.toneExposure ?? 1.4;

    const camera = new THREE.PerspectiveCamera(72, w / h, 0.12, 50000);

    const heading = col.querySelector("[data-pov-heading]");
    const initialId = ui3d.DEFAULT_POV_AGENTS[i] || scenario.agents[i]?.id || scenario.agents[0]?.id;
    if (heading && initialId) heading.textContent = `FPV · ${initialId}`;

    const entry = {
      industrialPov: true,
      col,
      canvas,
      renderer,
      camera,
      /** @type {THREE.SpotLight | null} */
      povSpot: null,
      resizeObserver: /** @type {ResizeObserver | null} */ (null),
      selectedId: initialId || "",
      smoothPos: new THREE.Vector3(),
      smoothLook: new THREE.Vector3(),
      smoothVel: 0,
      smoothHdg: 0,
      hud: {
        alt: col.querySelector("[data-hud='alt']"),
        hdg: col.querySelector("[data-hud='hdg']"),
        vel: col.querySelector("[data-hud='vel']"),
        pwr: col.querySelector("[data-hud='pwr']"),
        target: col.querySelector("[data-hud='target']"),
        heading,
      },
    };
    const ro = new ResizeObserver(() => resizeIndustrialMissionPov(entry));
    ro.observe(povFrame);
    entry.resizeObserver = ro;
    entries.push(entry);
  }

  if (entries.length === 0) {
    emitToast("default", "Industrial 3D: no POV canvases found.");
    return;
  }

  indScene = new THREE.Scene();
  indScene.background = new THREE.Color(s3.background);
  indScene.fog = null;
  indScene.environmentIntensity = s3.environmentIntensity ?? 0.65;

  const pmrem = new THREE.PMREMGenerator(entries[0].renderer);
  pmrem.compileCubemapShader();
  indEnvTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  indScene.environment = indEnvTarget.texture;
  pmrem.dispose();

  indScene.add(new THREE.AmbientLight(s3.ambient.color, s3.ambient.intensity));
  const hemi = new THREE.HemisphereLight(s3.hemi.sky, s3.hemi.ground, s3.hemi.intensity);
  indScene.add(hemi);
  const key = new THREE.DirectionalLight(s3.key.color, s3.key.intensity);
  key.position.set(20, 30, 10);
  indScene.add(key);
  const fill = new THREE.DirectionalLight(s3.fill.color, s3.fill.intensity);
  fill.position.set(-15, 12, -8);
  indScene.add(fill);
  indRimLight = new THREE.PointLight(s3.rim.color, s3.rim.intensity, 0, 2);
  indRimLight.position.set(0, 4000, 0);
  indScene.add(indRimLight);

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(draco);

  let gltf;
  try {
    gltf = await loader.loadAsync(gltfAssetUrl());
  } catch (e) {
    draco.dispose();
    for (const entry of entries) {
      entry.resizeObserver?.disconnect();
      try {
        entry.renderer.dispose();
      } catch {
        /* ignore */
      }
    }
    indScene.environment = null;
    indEnvTarget?.dispose();
    indEnvTarget = null;
    indRimLight = null;
    if (indScene) {
      disposeSceneResources(indScene);
      indScene.clear();
      indScene = null;
    }
    throw e;
  }
  draco.dispose();

  if (bootId !== indBootGeneration) return;

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  applyIndustrialFacilityVerticalSquash(root);

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    if (!o.material) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0x6a7588,
        roughness: 0.88,
        metalness: 0.06,
        side: THREE.DoubleSide,
      });
      return;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) tuneIndustrialPreviewMaterial(mat, o.geometry);
  });

  indFacilityRoot = root;
  indScene.add(root);

  const fitBox = new THREE.Box3().setFromObject(root);
  const fitSize = fitBox.getSize(new THREE.Vector3());
  const fitCenter = fitBox.getCenter(new THREE.Vector3());
  const fitMaxDim = Math.max(fitSize.x, fitSize.y, fitSize.z, 1);
  const fitDiag = Math.max(fitSize.length(), 50);

  if (indRimLight) {
    indRimLight.position.set(fitCenter.x, fitCenter.y + fitMaxDim * 0.42, fitCenter.z);
    indRimLight.distance = Math.max(fitMaxDim * 8, 15000);
  }

  const fogDensityScaled = s3.fogDensity * (refTheatreDiagonal / fitDiag);
  indScene.fog = new THREE.FogExp2(s3.fogColor, fogDensityScaled);

  const cementY = INDUSTRIAL_CEMENT_GROUND_WORLD_Y;
  let cementPlaneSize = 0;
  if (cementY != null && Number.isFinite(cementY)) {
    const { mesh: cementMesh, planeSize } = createIndustrialCementGroundPlane(root, cementY);
    indCementGround = cementMesh;
    cementPlaneSize = planeSize;
    indScene.add(cementMesh);
    for (const entry of entries) {
      const aniso = Math.min(16, entry.renderer.capabilities.getMaxAnisotropy());
      const mm = cementMesh.material;
      if (mm?.map) mm.map.anisotropy = aniso;
      if (mm?.bumpMap) mm.bumpMap.anisotropy = aniso;
    }
  } else {
    indCementGround = null;
  }

  if (cementPlaneSize > 0 && cementY != null && Number.isFinite(cementY)) {
    const farNeed = Math.max(cementPlaneSize * 8, Math.abs(cementY) + cementPlaneSize * 2, 120000);
    for (const entry of entries) {
      entry.camera.far = Math.max(entry.camera.far, farNeed);
      entry.camera.updateProjectionMatrix();
    }
  }

  setIndustrialGridMappingFromFacility(root, scenario, cementY);
  buildIndustrialAgentMeshes(scenario);

  const tBoot = performance.now() / 1000;
  for (const entry of entries) {
    entry.camera.near = Math.max(industrialCellSpan * 0.035, 1.5);
    const spotDist = Math.max(520, industrialCellSpan * 38);
    const povSpot = new THREE.SpotLight(0xffd9a0, 3.2, spotDist, Math.PI / 4, 0.38, 1.05);
    povSpot.position.set(0, 0, 0);
    povSpot.target.position.set(0, -industrialCellSpan * 0.12, -industrialCellSpan * 8);
    entry.camera.add(povSpot);
    entry.camera.add(povSpot.target);
    entry.povSpot = povSpot;
    indScene.add(entry.camera);

    const driver = scenario.agents.find((a) => a.id === entry.selectedId) || scenario.agents[0];
    if (driver) {
      const prev = driver.prevLocation || driver.location;
      const ix = prev[0];
      const iy = prev[1];
      const planar = industrialGridToWorldXZ(ix, iy);
      const alt =
        industrialGroundY +
        industrialCellSpan * tacticalFpvAltitudeUrbanUnits(driver, tBoot);
      entry.smoothPos.set(planar.x, alt, planar.z);
      const isAerialBoot = driver.type === "drone" || driver.type === "balloon";
      const fwd = tacticalFpvForwardVector(
        driver,
        prev,
        ix,
        iy,
        tBoot,
        null,
        industrialGridToWorldXZ,
        industrialCellSpan
      );
      const lookDist = tacticalFpvLookDistanceWorld(isAerialBoot, industrialCellSpan);
      entry.smoothLook.copy(entry.smoothPos).addScaledVector(fwd, lookDist);
      entry.camera.position.copy(entry.smoothPos);
      entry.camera.lookAt(entry.smoothLook);
    }

    resizeIndustrialMissionPov(entry);
    povs.push(entry);
  }

  buildAgentSelector(scenario.agents);
}

/**
 * @param {number} bootId
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} povFrame
 * @param {boolean} [enableHeightCalibration] — only for `industrial-preview.html` debugging (HUD + Shift+click copy Y).
 */
async function bootIndustrialGlb(bootId, canvas, povFrame, enableHeightCalibration = false) {
  indRimLight = null;
  indStandaloneActive = true;

  detachIndustrialHeightCalibrationUi();

  const s3 = PRESET_VISUAL.industrial.scene3d;
  /** Urban FPV theatre diagonal (~30×30 map); scale fog so huge GLBs stay readable. */
  const refTheatreDiagonal = 42;

  const w = Math.max(1, povFrame.clientWidth);
  const h = Math.max(1, povFrame.clientHeight);

  indRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  indRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  indRenderer.setSize(w, h, false);

  indRenderer.setClearColor(s3.rendererClear, 1);
  indRenderer.outputColorSpace = THREE.SRGBColorSpace;
  indRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  indRenderer.toneMappingExposure = s3.toneExposure ?? 1.4;

  indCamera = new THREE.PerspectiveCamera(48, w / h, 0.05, 50000);
  indCamera.position.set(22, 16, 32);

  indScene = new THREE.Scene();
  indScene.background = new THREE.Color(s3.background);
  indScene.fog = null;
  indScene.environmentIntensity = s3.environmentIntensity ?? 0.65;

  const pmrem = new THREE.PMREMGenerator(indRenderer);
  pmrem.compileCubemapShader();
  indEnvTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  indScene.environment = indEnvTarget.texture;
  pmrem.dispose();

  // Match urban-quake.init3D rig: ambient + hemi + key/fill directionals + point rim.
  indScene.add(new THREE.AmbientLight(s3.ambient.color, s3.ambient.intensity));
  const hemi = new THREE.HemisphereLight(s3.hemi.sky, s3.hemi.ground, s3.hemi.intensity);
  indScene.add(hemi);
  const key = new THREE.DirectionalLight(s3.key.color, s3.key.intensity);
  key.position.set(20, 30, 10);
  indScene.add(key);
  const fill = new THREE.DirectionalLight(s3.fill.color, s3.fill.intensity);
  fill.position.set(-15, 12, -8);
  indScene.add(fill);
  indRimLight = new THREE.PointLight(s3.rim.color, s3.rim.intensity, 0, 2);
  indRimLight.position.set(0, 4000, 0);
  indScene.add(indRimLight);

  indControls = new OrbitControls(indCamera, indRenderer.domElement);
  indControls.enableDamping = true;
  indControls.dampingFactor = 0.06;
  indControls.target.set(0, 2.5, 0);
  indControls.update();

  indResizeObserver = new ResizeObserver(() => {
    if (!indRenderer || !indCamera || bootId !== indBootGeneration) return;
    const nw = Math.max(1, povFrame.clientWidth);
    const nh = Math.max(1, povFrame.clientHeight);
    indRenderer.setSize(nw, nh, false);
    indCamera.aspect = nw / nh;
    indCamera.updateProjectionMatrix();
  });
  indResizeObserver.observe(povFrame);

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(draco);

  let gltf;
  try {
    gltf = await loader.loadAsync(gltfAssetUrl());
  } catch (e) {
    draco.dispose();
    throw e;
  }
  draco.dispose();

  if (bootId !== indBootGeneration) return;

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  applyIndustrialFacilityVerticalSquash(root);

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    if (!o.material) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0x6a7588,
        roughness: 0.88,
        metalness: 0.06,
        side: THREE.DoubleSide,
      });
      return;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) tuneIndustrialPreviewMaterial(mat, o.geometry);
  });

  indFacilityRoot = root;
  indScene.add(root);

  frameCameraOnContent(indCamera, indControls, root);

  const fitBox = new THREE.Box3().setFromObject(root);
  const fitSize = fitBox.getSize(new THREE.Vector3());
  const fitCenter = fitBox.getCenter(new THREE.Vector3());
  const fitMaxDim = Math.max(fitSize.x, fitSize.y, fitSize.z, 1);
  const fitDiag = Math.max(fitSize.length(), 50);

  if (indRimLight) {
    indRimLight.position.set(fitCenter.x, fitCenter.y + fitMaxDim * 0.42, fitCenter.z);
    indRimLight.distance = Math.max(fitMaxDim * 8, 15000);
  }

  const fogDensityScaled = s3.fogDensity * (refTheatreDiagonal / fitDiag);
  indScene.fog = new THREE.FogExp2(s3.fogColor, fogDensityScaled);

  const cementY = INDUSTRIAL_CEMENT_GROUND_WORLD_Y;
  let cementPlaneSize = 0;
  if (cementY != null && Number.isFinite(cementY)) {
    const { mesh: cementMesh, planeSize } = createIndustrialCementGroundPlane(root, cementY);
    indCementGround = cementMesh;
    cementPlaneSize = planeSize;
    indScene.add(cementMesh);
    if (indRenderer) {
      const aniso = Math.min(16, indRenderer.capabilities.getMaxAnisotropy());
      const mm = cementMesh.material;
      if (mm?.map) mm.map.anisotropy = aniso;
      if (mm?.bumpMap) mm.bumpMap.anisotropy = aniso;
    }
  } else {
    indCementGround = null;
  }

  if (cementPlaneSize > 0 && cementY != null && Number.isFinite(cementY)) {
    indCamera.far = Math.max(indCamera.far, cementPlaneSize * 8, Math.abs(cementY) + cementPlaneSize * 2, 120000);
  }
  indCamera.updateProjectionMatrix();

  if (enableHeightCalibration) {
    attachIndustrialHeightCalibration(canvas, povFrame, bootId);
  }

  indRafId = requestAnimationFrame(animateIndustrial);
}

function disposeSceneResources(scene) {
  const seenGeo = new Set();
  scene?.traverse((obj) => {
    if (obj.isInstancedMesh || obj.isMesh) {
      const g = obj.geometry;
      if (g && !seenGeo.has(g)) {
        g.dispose();
        seenGeo.add(g);
      }
      const mats = obj.material;
      if (Array.isArray(mats)) mats.forEach((mat) => mat?.dispose?.());
      else mats?.dispose?.();
    }
  });
}

/**
 * Standalone full-window preview (no mission shell): same GLB orbit as mission POV.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} [hostEl] ResizeObserver target; default `canvas.parentElement` or `document.body`
 */
export function initIndustrialStandalonePreview(canvas, hostEl) {
  const frame = hostEl ?? canvas.parentElement ?? document.body;
  indBootGeneration += 1;
  const bootId = indBootGeneration;
  void bootIndustrialGlb(bootId, canvas, frame, true).catch((err) => {
    console.error("[industrial standalone]", err);
  });
}

export function init3D(scenario, presetKey, povCols) {
  if (!povCols?.length) return;

  setCurrentScenePreset(presetKey || "industrial");
  indBootGeneration += 1;
  const bootId = indBootGeneration;

  applyIndustrialViewportChrome();

  void bootIndustrialMission(bootId, scenario, povCols).catch((err) => {
    console.error("[industrial mission]", err);
    emitToast("default", "Industrial GLB failed to load — check console.");
  });
}

export function update3D(t, sim) {
  if (!indScene) return;
  const { state, plan, lastTickAt, msPerTick } = sim || {};
  const frac =
    state && lastTickAt != null && msPerTick != null
      ? Math.min(1, Math.max(0, (performance.now() - lastTickAt) / msPerTick))
      : 0;
  const mspt = msPerTick || 500;

  if (state?.agents) {
    for (const a of state.agents) {
      const holder = industrialAgentHolders.get(a.id);
      if (!holder) continue;
      const inner = holder.children[0];
      if (!inner) continue;

      const prev = a.prevLocation || a.location;
      const ix = THREE.MathUtils.lerp(prev[0], a.location[0], frac);
      const iy = THREE.MathUtils.lerp(prev[1], a.location[1], frac);
      const { x, z } = industrialGridToWorldXZ(ix, iy);

      const targetY =
        industrialGroundY + industrialCellSpan * tacticalFpvAltitudeUrbanUnits(a, t);
      holder.position.set(x, targetY, z);

      const dx = a.location[0] - prev[0];
      const dy = a.location[1] - prev[1];
      if (Math.abs(dx) + Math.abs(dy) > 0.001) {
        const yaw = Math.atan2(dx, dy);
        holder.rotation.y = THREE.MathUtils.lerp(holder.rotation.y, yaw, 0.15);
      }

      const ud = inner.userData;
      if (ud.rotors) {
        for (let i = 0; i < ud.rotors.length; i += 1) {
          ud.rotors[i].rotation.y = t * 30 + i * 0.5;
        }
      }
      if (ud.navLight) {
        const blink = 0.5 + 0.5 * Math.sin(t * 6 + a.id.charCodeAt(0));
        ud.navLight.intensity = a.type === "drone" ? 1.4 + blink * 0.6 : 0.9 + blink * 0.3;
      }
      if (ud.beacon) {
        const pulse = (Math.sin(t * 4.5 + a.id.charCodeAt(0)) + 1) * 0.5;
        const m = ud.beacon.material;
        if (m && m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6 + pulse * 4;
      }
      if (ud.statusRing) {
        const slow = (Math.sin(t * 1.2 + a.id.charCodeAt(0)) + 1) * 0.5;
        const m = ud.statusRing.material;
        if (m && m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6 + slow * 1.4;
      }
    }
  }

  for (const entry of povs) {
    if (!entry.industrialPov) continue;
    const { renderer, camera } = entry;
    if (!renderer || !camera) continue;

    const driver =
      state?.agents?.find((a) => a.id === entry.selectedId) || state?.agents?.[0];
    if (!driver || !state) {
      renderer.render(indScene, camera);
      continue;
    }

    const prev = driver.prevLocation || driver.location;
    const ix = THREE.MathUtils.lerp(prev[0], driver.location[0], frac);
    const iy = THREE.MathUtils.lerp(prev[1], driver.location[1], frac);

    const phaseSeed = tacticalFpvPhaseSeed(driver);
    const isAerial = driver.type === "drone" || driver.type === "balloon";
    const headBobX = isAerial ? Math.sin(t * 1.6 + phaseSeed) * 0.05 : 0;
    const headBobY = isAerial ? Math.sin(t * 2.2 + phaseSeed) * 0.04 : 0;

    const targetPos = tacticalFpvEyeWorldPosition(ix, iy, driver, t, industrialGridToWorldXZ, {
      groundY: industrialGroundY,
      pitchScale: industrialCellSpan,
      headBobX,
      headBobY,
    });

    const tgtCell = currentTargetFor(driver, state, plan);
    const fwd = tacticalFpvForwardVector(
      driver,
      prev,
      ix,
      iy,
      t,
      tgtCell,
      industrialGridToWorldXZ,
      industrialCellSpan
    );
    const lookDist = tacticalFpvLookDistanceWorld(isAerial, industrialCellSpan);
    const lookAt = targetPos.clone().addScaledVector(fwd, lookDist);

    entry.smoothPos.lerp(targetPos, 0.18);
    entry.smoothLook.lerp(lookAt, 0.12);
    camera.position.copy(entry.smoothPos);
    camera.lookAt(entry.smoothLook);

    const vel =
      Math.hypot(driver.location[0] - prev[0], driver.location[1] - prev[1]) / (mspt / 1000);
    entry.smoothVel = THREE.MathUtils.lerp(entry.smoothVel, vel, 0.15);
    const hdgRad = Math.atan2(driver.location[0] - prev[0], driver.location[1] - prev[1]);
    const hdgDeg = ((hdgRad * 180) / Math.PI + 360) % 360;
    entry.smoothHdg = lerpAngleDeg(entry.smoothHdg, hdgDeg, 0.12);

    const hudAlt = tacticalFpvHudAltIndustrialRelative(
      driver,
      t,
      headBobY,
      industrialGroundY,
      industrialCellSpan
    );
    if (entry.hud.alt) entry.hud.alt.textContent = hudAlt.toFixed(1);
    if (entry.hud.hdg) entry.hud.hdg.textContent = String(Math.round(entry.smoothHdg)).padStart(3, "0");
    if (entry.hud.vel) entry.hud.vel.textContent = entry.smoothVel.toFixed(1);
    if (entry.hud.pwr) entry.hud.pwr.textContent = `${Math.round(driver.battery)}%`;
    if (entry.hud.target) {
      const tid = currentTargetIdFor(driver, plan);
      entry.hud.target.textContent = tid ? `TGT ${tid}` : "TGT —";
    }

    for (const [id, h] of industrialAgentHolders) {
      h.visible = id !== driver.id;
    }
    renderer.render(indScene, camera);
  }

  for (const h of industrialAgentHolders.values()) {
    h.visible = true;
  }

  const lead = povs.find((e) => e.industrialPov);
  if (indCementGround && lead?.smoothPos) {
    indCementGround.position.x = lead.smoothPos.x;
    indCementGround.position.z = lead.smoothPos.z;
  }
}

export function teardown3D() {
  indBootGeneration += 1;
  indStandaloneActive = false;

  teardownAgentSelector();

  industrialAgentHolders.clear();

  indCementGround = null;
  indRimLight = null;

  teardownIndustrialHeightCalibration();

  povColumnEl()?.classList.remove("industrial-glb-active");

  for (const entry of [...povs]) {
    entry.resizeObserver?.disconnect();
    if (entry.industrialPov && entry.camera && indScene) {
      indScene.remove(entry.camera);
    }
    try {
      entry.renderer?.dispose();
    } catch {
      /* ignore */
    }
    const parent = entry.canvas?.parentElement;
    if (parent && entry.canvas) {
      const fresh = entry.canvas.cloneNode(false);
      parent.replaceChild(fresh, entry.canvas);
    }
  }
  povs.length = 0;

  indResizeObserver?.disconnect();
  indResizeObserver = null;

  if (indRafId != null) {
    cancelAnimationFrame(indRafId);
    indRafId = null;
  }

  indControls?.dispose();
  indControls = null;

  indScene.environment = null;
  indEnvTarget?.dispose();
  indEnvTarget = null;

  if (indScene) {
    disposeSceneResources(indScene);
    indScene.clear();
    indScene = null;
  }

  indFacilityRoot = null;

  indCamera = null;

  if (indRenderer) {
    try {
      indRenderer.dispose();
    } catch {
      /* ignore */
    }
    indRenderer = null;
  }

  if (ui3d.agentSelectorHost) ui3d.agentSelectorHost.innerHTML = "";
  ui3d.agentCardEls?.clear?.();
}

export function buildingAvoidanceRects(scenario) {
  return urbanQuakeBuildingAvoidanceRects(scenario);
}
