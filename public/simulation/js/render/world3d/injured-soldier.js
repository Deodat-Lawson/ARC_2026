/**
 * Shared loader / instancer for the injured-soldier OBJ used to mark victims
 * in every scenario (urban-quake, wildfire, industrial). The source OBJ is
 * a posed prone figure with bbox X≈428, Y≈92, Z≈240 — Y is body thickness,
 * not height. We scale uniformly by the LONGEST axis so the figure renders
 * as a ~1.9m casualty regardless of which axis the source uses for length.
 */
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

const MODELS_PATH = "/models/";
const MODEL_OBJ = "injured-soldier.obj";
const MODEL_MTL = "injured-soldier.mtl";

let prototypePromise = null;

/** Length of the prone figure (longest source axis) in world units. */
export const INJURED_SOLDIER_LENGTH = 1.9;

/** Promise → cached THREE.Group prototype (loaded once, cloned per victim). */
export function loadInjuredSoldierPrototype() {
  if (prototypePromise) return prototypePromise;
  prototypePromise = new Promise((resolve, reject) => {
    const mtl = new MTLLoader();
    mtl.setPath(MODELS_PATH);
    mtl.setResourcePath(MODELS_PATH);
    mtl.load(
      MODEL_MTL,
      (creator) => {
        creator.preload();
        const obj = new OBJLoader();
        obj.setMaterials(creator);
        obj.setPath(MODELS_PATH);
        obj.load(MODEL_OBJ, resolve, undefined, reject);
      },
      undefined,
      reject,
    );
  });
  return prototypePromise;
}

/**
 * Returns a fresh THREE.Group containing the soldier sized to `length`
 * (world units) along its longest axis, recentred so the bottom of the
 * bbox is at local y=0 and XZ centre is at local (0,0). Materials are
 * cloned + retinted to olive-drab so it reads as a casualty in fog rather
 * than the source's default grey Kd.
 */
export function createInjuredSoldierInstance(prototype, length = INJURED_SOLDIER_LENGTH) {
  const root = prototype.clone(true);

  // Per-instance material clone so emissive/tint tweaks don't bleed
  // across victims sharing the same source material.
  const olive = new THREE.Color(0x4a4233);
  const emissive = new THREE.Color(0x2a1408);
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => cloneAndTint(m, olive, emissive));
    } else if (obj.material) {
      obj.material = cloneAndTint(obj.material, olive, emissive);
    }
    obj.castShadow = false;
    obj.receiveShadow = false;
  });

  const bbox = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const longest = Math.max(size.x, size.y, size.z, 0.001);
  const s = length / longest;

  const wrapper = new THREE.Group();
  wrapper.scale.setScalar(s);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  wrapper.add(root);
  root.position.set(-center.x, -bbox.min.y, -center.z);

  // Outer group so callers can position/rotate without disturbing the
  // recentre offset on `root`.
  const outer = new THREE.Group();
  outer.add(wrapper);
  return outer;
}

function cloneAndTint(material, color, emissive) {
  const m = material.clone();
  if (m.color) m.color.copy(color);
  if ("emissive" in m && m.emissive) {
    m.emissive.copy(emissive);
    if ("emissiveIntensity" in m) m.emissiveIntensity = 0.35;
  }
  return m;
}
