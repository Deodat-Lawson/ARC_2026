/**
 * Wildfire preset: procedural meadow + EZ-Tree (scene core in wildfire-meadow-scene.js).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { setCurrentScenePreset } from "../../config/presets.js";
import { ui3d } from "./tactical-pov-shell.js";
import { buildingAvoidanceRects as urbanQuakeBuildingAvoidanceRects } from "./urban-quake.js";
import { emitToast } from "../../ui/toast.js";
import {
  grassWindTimeUniform,
  createSkyDomeMesh,
  createWildfireMeadowRoot,
  FOG_COLOR_HEX,
  MEADOW_FOG_FAR,
  MEADOW_FOG_NEAR,
  SKY_BOTTOM,
  WILDFIRE_LIGHT_LEGACY_SCALE,
} from "./wildfire-meadow-scene.js";

let wfScene = null;
/** @type {THREE.WebGLRenderer | null} */
let wfRenderer = null;
/** @type {THREE.PerspectiveCamera | null} */
let wfCamera = null;
/** @type {OrbitControls | null} */
let wfControls = null;
/** @type {ResizeObserver | null} */
let wfResizeObserver = null;
/** @type {number | null} */
let wfRafId = null;
let wfBootGeneration = 0;

/** EZ-Tree instances currently bound (wind animation). */
let wfEzTrees = [];
/** @type {THREE.Group | null} */
let wfForestRoot = null;

function povColumnEl() {
  return document.querySelector(".map-pov-col");
}

function applyWildfireViewportChrome() {
  const col = povColumnEl();
  if (!col) return;
  col.classList.add("wildfire-splat-active");

  const kicker = col.querySelector(".vp-head .kicker");
  if (kicker) kicker.textContent = "M01 · Forest theatre · EZ-Tree";

  const h2 = col.querySelector("[data-pov-heading]");
  if (h2) h2.textContent = "Wildfire scenario · procedural forest";

  const sub = col.querySelector("[data-pov-sub]");
  if (sub) sub.textContent = "Drag orbit · scroll zoom · right-drag pan";

  const tag = col.querySelector(".vp-head .panel-tag");
  if (tag) {
    tag.textContent = "3D";
    tag.classList.remove("warn");
    tag.classList.add("accent");
  }

  if (ui3d.agentSelectorHost) {
    ui3d.agentSelectorHost.innerHTML = "";
    ui3d.agentCardEls.clear();
    const note = document.createElement("div");
    note.className = "wildfire-pov-note";
    note.setAttribute("role", "note");
    note.textContent =
      "Trees from EZ-Tree (@dgreenheck/ez-tree). Fleet stays on the 2D map — decorative viewport only.";
    ui3d.agentSelectorHost.appendChild(note);
  }

  if (ui3d.povSubEl) ui3d.povSubEl.textContent = "Three.js · EZ-Tree";
}

function frameCameraOnContent(camera, controls, root) {
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.72;
    camera.near = Math.max(0.01, maxDim / 2000);
    camera.far = Math.max(5000, maxDim * 40);
    camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(dist * 0.42, dist * 0.38, dist * 0.52)));
    controls.target.copy(center);
    controls.update();
    camera.lookAt(center);
    return;
  }

  camera.position.set(12, 10, 18);
  controls.target.set(0, 2, 0);
  controls.update();
}

function animateWildfire() {
  wfRafId = requestAnimationFrame(animateWildfire);
  if (!wfRenderer || !wfScene || !wfCamera || !wfControls) return;
  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
  grassWindTimeUniform.value = elapsed;
  wfForestRoot?.userData?.tickWildfireBurn?.(elapsed);
  for (let i = 0; i < wfEzTrees.length; i++) wfEzTrees[i]?.update?.(elapsed);
  wfControls.update();
  wfRenderer.render(wfScene, wfCamera);
}

/**
 * @param {number} bootId
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} povFrame
 */
function bootWildfireForest(bootId, canvas, povFrame) {
  const w = Math.max(1, povFrame.clientWidth);
  const h = Math.max(1, povFrame.clientHeight);

  wfRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  /** Meadow is fill-rate heavy; modest cap trims fragment cost on retina without large visual loss. */
  wfRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));
  wfRenderer.setSize(w, h, false);

  const horizon = SKY_BOTTOM.clone().multiplyScalar(0.92).getHex();
  wfRenderer.setClearColor(horizon, 1);
  wfRenderer.outputColorSpace = THREE.SRGBColorSpace;
  wfRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  wfRenderer.toneMappingExposure = 1.14;

  wfCamera = new THREE.PerspectiveCamera(50, w / h, 0.05, 50000);
  wfCamera.position.set(15, 12, 22);

  wfScene = new THREE.Scene();
  wfScene.background = new THREE.Color(horizon);
  wfScene.fog = new THREE.Fog(FOG_COLOR_HEX, MEADOW_FOG_NEAR, MEADOW_FOG_FAR);

  wfScene.add(createSkyDomeMesh());

  const Ls = WILDFIRE_LIGHT_LEGACY_SCALE;

  wfScene.add(new THREE.HemisphereLight(0xd6eeff, 0x5c4a36, 1.08));
  const sun = new THREE.DirectionalLight(0xfff8ea, 1.42);
  sun.position.set(52 * Ls, 76 * Ls, 38 * Ls);
  wfScene.add(sun);
  const fillSun = new THREE.DirectionalLight(0xd4e8ff, 0.42);
  fillSun.position.set(-44 * Ls, 38 * Ls, -42 * Ls);
  wfScene.add(fillSun);
  wfScene.add(new THREE.AmbientLight(0xd8eaf5, 0.38));

  wfControls = new OrbitControls(wfCamera, wfRenderer.domElement);
  wfControls.enableDamping = true;
  wfControls.dampingFactor = 0.06;
  wfControls.target.set(0, 3, 0);
  wfControls.update();

  wfResizeObserver = new ResizeObserver(() => {
    if (!wfRenderer || !wfCamera || bootId !== wfBootGeneration) return;
    const nw = Math.max(1, povFrame.clientWidth);
    const nh = Math.max(1, povFrame.clientHeight);
    wfRenderer.setSize(nw, nh, false);
    wfCamera.aspect = nw / nh;
    wfCamera.updateProjectionMatrix();
  });
  wfResizeObserver.observe(povFrame);

  if (bootId !== wfBootGeneration) return;

  try {
    const texAnisoCeil = Math.min(8, wfRenderer.capabilities.getMaxAnisotropy());
    const { root: forestRoot, trees } = createWildfireMeadowRoot({
      maxMapAniso: texAnisoCeil,
      shouldAbort: () => bootId !== wfBootGeneration,
      onTreeMountComplete: () => frameCameraOnContent(wfCamera, wfControls, forestRoot),
    });
    wfEzTrees = trees;
    wfForestRoot = forestRoot;
    wfScene.add(forestRoot);
    frameCameraOnContent(wfCamera, wfControls, forestRoot);
  } catch (err) {
    console.error("[wildfire ez-tree]", err);
    wfEzTrees = [];
    wfForestRoot = null;
    emitToast("default", "EZ-Tree forest failed — check console.");
  }

  wfRafId = requestAnimationFrame(animateWildfire);
}

function disposeSceneResources(scene) {
  const seenGeo = new Set();
  scene?.traverse((obj) => {
    if (!obj.isInstancedMesh && !obj.isMesh && !obj.isPoints) return;

    const g = obj.geometry;
    if (g && !seenGeo.has(g)) {
      g.dispose();
      seenGeo.add(g);
    }
    const mats = obj.material;
    const list = Array.isArray(mats) ? mats : [mats];
    for (const mat of list) {
      if (!mat) continue;
      if (typeof mat.map?.dispose === "function") mat.map.dispose();
      mat.dispose?.();
    }
  });
}

export function init3D(scenario, presetKey, povCols) {
  void scenario;
  const col = povCols?.[0];
  const canvas = col?.querySelector("[data-pov-canvas]");
  const povFrame = canvas?.parentElement;
  if (!canvas || !povFrame) return;

  setCurrentScenePreset(presetKey || "wildfire");
  wfBootGeneration += 1;
  const bootId = wfBootGeneration;

  applyWildfireViewportChrome();

  bootWildfireForest(bootId, canvas, povFrame);
}

export function update3D(_t, _sim) {}

export function teardown3D() {
  wfBootGeneration += 1;

  povColumnEl()?.classList.remove("wildfire-splat-active");

  wfResizeObserver?.disconnect();
  wfResizeObserver = null;

  if (wfRafId != null) {
    cancelAnimationFrame(wfRafId);
    wfRafId = null;
  }

  wfControls?.dispose();
  wfControls = null;

  wfEzTrees = [];
  wfForestRoot = null;

  if (wfScene) {
    wfScene.getObjectByName("wildfire_ez_forest")?.userData?.cancelWildfireEzTreeMount?.();
    disposeSceneResources(wfScene);
    wfScene.clear();
    wfScene = null;
  }

  wfCamera = null;

  if (wfRenderer) {
    try {
      wfRenderer.dispose();
    } catch {
      /* ignore */
    }
    wfRenderer = null;
  }

  if (ui3d.agentSelectorHost) ui3d.agentSelectorHost.innerHTML = "";
  ui3d.agentCardEls.clear();
}

export function buildingAvoidanceRects(scenario) {
  return urbanQuakeBuildingAvoidanceRects(scenario);
}
