/**
 * Standalone full-window preview for wildfire meadow (no simulation shell).
 * Open via dev server: http://localhost:3000/simulation/wildfire-meadow-preview.html
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  grassWindTimeUniform,
  createSkyDomeMesh,
  createWildfireMeadowRoot,
  FOG_COLOR_HEX,
  SKY_BOTTOM,
} from "./render/world3d/wildfire-meadow-scene.js";

function disposeSceneMeshes(scene) {
  const seenGeo = new Set();
  scene?.traverse((obj) => {
    if (!obj.isMesh && !obj.isInstancedMesh) return;
    const g = obj.geometry;
    if (g && !seenGeo.has(g)) {
      g.dispose();
      seenGeo.add(g);
    }
    const mats = obj.material;
    if (Array.isArray(mats)) mats.forEach((m) => m?.dispose?.());
    else mats?.dispose?.();
  });
}

function frameCamera(camera, controls, root) {
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

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("meadowCanvas"));
if (!canvas) throw new Error("#meadowCanvas missing");

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let raf = 0;
/** @type {unknown[]} */
let ezTrees = [];

function resize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}

function boot() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);

  const horizon = SKY_BOTTOM.clone().multiplyScalar(0.92).getHex();
  renderer.setClearColor(horizon, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;

  camera = new THREE.PerspectiveCamera(50, w / h, 0.05, 50000);
  camera.position.set(15, 12, 22);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(horizon);
  scene.fog = new THREE.Fog(FOG_COLOR_HEX, 22, 238);

  scene.add(createSkyDomeMesh());

  scene.add(new THREE.HemisphereLight(0xd6eeff, 0x5c4a36, 1.08));
  const sun = new THREE.DirectionalLight(0xfff8ea, 1.42);
  sun.position.set(52, 76, 38);
  scene.add(sun);
  const fillSun = new THREE.DirectionalLight(0xd4e8ff, 0.42);
  fillSun.position.set(-44, 38, -42);
  scene.add(fillSun);
  scene.add(new THREE.AmbientLight(0xd8eaf5, 0.38));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 3, 0);
  controls.update();

  const { root: meadowRoot, trees } = createWildfireMeadowRoot();
  ezTrees = trees;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  meadowRoot.traverse((o) => {
    if (!o.isMesh || !o.material?.map) return;
    o.material.map.anisotropy = Math.min(14, maxAniso);
  });

  scene.add(meadowRoot);
  frameCamera(camera, controls, meadowRoot);

  window.addEventListener("resize", resize);

  function loop() {
    raf = requestAnimationFrame(loop);
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    grassWindTimeUniform.value = t;
    for (let i = 0; i < ezTrees.length; i++) {
      const tr = ezTrees[i];
      if (tr && typeof tr.update === "function") tr.update(t);
    }
    controls?.update();
    renderer.render(scene, camera);
  }
  loop();
}

boot();

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(raf);
  window.removeEventListener("resize", resize);
  controls?.dispose();
  if (scene) {
    disposeSceneMeshes(scene);
    scene.clear();
  }
  renderer?.dispose();
});
