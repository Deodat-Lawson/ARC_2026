/**
 * 2D tactical map entry — dispatch by env.scenePreset.
 */
import { drawMap2D as drawUrbanQuakeMap2D } from "./urban-quake.js";
import { drawWildfireMap2D } from "./wildfire-map2d.js";

/** @param {string | undefined} scenePreset */
function map2dRendererFor(scenePreset) {
  switch (scenePreset) {
    case "wildfire":
      return drawWildfireMap2D;
    case "urban_quake":
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
