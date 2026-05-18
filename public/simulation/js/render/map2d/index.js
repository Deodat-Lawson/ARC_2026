/**
 * 2D tactical map entry — dispatch by env.scenePreset.
 * Add wildfire.js / industrial.js and extend map2dFor().
 */
import { drawMap2D as drawUrbanQuakeMap2D } from "./urban-quake.js";

/** @param {string | undefined} scenePreset */
function map2dRendererFor(scenePreset) {
  switch (scenePreset) {
    case "urban_quake":
    case "wildfire":
    case "industrial":
    default:
      return drawUrbanQuakeMap2D;
  }
}

/** @param {object} env drawMap2D options (see urban-quake.js typedef Map2DEnv) */
export function drawMap2D(env) {
  const fn = map2dRendererFor(env?.scenePreset);
  fn(env);
}
