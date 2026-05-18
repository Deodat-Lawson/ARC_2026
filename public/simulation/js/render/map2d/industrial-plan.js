/**
 * Top-down orthographic raster of `industrial-scene.glb` for the 2D tactical underlay.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { resolveIndustrialSceneGltfUrl } from "../../config/industrial-scene-asset.js";

const RASTER_SIZE = 1536;

/** @type {HTMLCanvasElement | null} */
let cachedRaster = null;

let loadStarted = false;

function industrialGltfHref() {
  return resolveIndustrialSceneGltfUrl();
}

async function rasterizeIndustrialFacilityTopDown() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(draco);

  let gltf;
  try {
    gltf = await loader.loadAsync(industrialGltfHref());
  } finally {
    draco.dispose();
  }

  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);

  root.traverse((o) => {
    if (!o.isMesh) return;
    const prev = o.material;
    if (Array.isArray(prev)) prev.forEach((m) => m?.dispose?.());
    else prev?.dispose?.();
    o.material = new THREE.MeshBasicMaterial({
      color: 0x96a4b4,
      side: THREE.DoubleSide,
    });
  });

  scene.add(root);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const pad = 1.07;
  const halfX = Math.max((size.x * pad) / 2, 50);
  const halfZ = Math.max((size.z * pad) / 2, 50);

  const span = Math.max(halfX * 2, halfZ * 2, size.y, 500);
  const cam = new THREE.OrthographicCamera(-halfX, halfX, halfZ, -halfZ, span * 0.02, span * 80);
  cam.position.set(center.x, center.y + span * 6, center.z);
  cam.up.set(0, 0, -1);
  cam.lookAt(center.x, center.y, center.z);
  cam.updateProjectionMatrix();

  const renderer = new THREE.WebGLRenderer({
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(RASTER_SIZE, RASTER_SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.render(scene, cam);

  const src = renderer.domElement;
  const copy = document.createElement("canvas");
  copy.width = RASTER_SIZE;
  copy.height = RASTER_SIZE;
  const c2 = copy.getContext("2d");
  if (c2) c2.drawImage(src, 0, 0);

  renderer.dispose();

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
    else m?.dispose?.();
  });

  cachedRaster = copy;
}

function ensureIndustrialPlanLoading() {
  if (loadStarted) return;
  loadStarted = true;
  void rasterizeIndustrialFacilityTopDown().catch((err) => {
    console.warn("[industrial plan] GLB → 平面图 raster failed:", err);
    cachedRaster = null;
  });
}

export function industrialPlanRasterReady() {
  return cachedRaster != null;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
export function drawIndustrialPlanUnderlay(ctx, w, h) {
  ensureIndustrialPlanLoading();
  if (!cachedRaster) return;
  ctx.drawImage(cachedRaster, 0, 0, w, h);
}
