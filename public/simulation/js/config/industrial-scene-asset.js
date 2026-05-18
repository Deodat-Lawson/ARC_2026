/**
 * Industrial theatre GLB — single source of truth for mission + 2D plan raster.
 * Asset: public/simulation/data/industrial/industrial-scene.glb
 */

/** Site-root path (Next serves `public/` at `/`). */
export const INDUSTRIAL_SCENE_PATH = "/simulation/data/industrial/industrial-scene.glb";

/**
 * @returns {string} URL passed to GLTFLoader (same-origin).
 */
export function resolveIndustrialSceneGltfUrl() {
  return INDUSTRIAL_SCENE_PATH;
}
