/**
 * 3D world / FPV entry — dispatch by preset.
 * Add wildfire.js / industrial.js and extend worldImplFor().
 */
import { currentScenePreset } from "../../config/presets.js";
import { ui3d, bindWorld3dUi, povs } from "./tactical-pov-shell.js";
import {
  world,
  buildingAvoidanceRects as urbanQuakeBuildingAvoidanceRects,
  init3D as initUrbanQuake3D,
  update3D as updateUrbanQuake3D,
  teardown3D as teardownUrbanQuake3D,
} from "./urban-quake.js";
import * as wildfireWorld from "./wildfire.js";
import * as industrialWorld from "./industrial.js";

export { ui3d, bindWorld3dUi, world, povs };

function worldImplFor(presetKey) {
  switch (presetKey) {
    case "wildfire":
      return {
        buildingAvoidanceRects: wildfireWorld.buildingAvoidanceRects,
        init3D: wildfireWorld.init3D,
        update3D: wildfireWorld.update3D,
        teardown3D: wildfireWorld.teardown3D,
      };
    case "industrial":
      return {
        buildingAvoidanceRects: industrialWorld.buildingAvoidanceRects,
        init3D: industrialWorld.init3D,
        update3D: industrialWorld.update3D,
        teardown3D: industrialWorld.teardown3D,
      };
    case "urban_quake":
    default:
      return {
        buildingAvoidanceRects: urbanQuakeBuildingAvoidanceRects,
        init3D: initUrbanQuake3D,
        update3D: updateUrbanQuake3D,
        teardown3D: teardownUrbanQuake3D,
      };
  }
}

export function buildingAvoidanceRects(scenario) {
  return worldImplFor(currentScenePreset).buildingAvoidanceRects(scenario);
}

export function init3D(scenario, presetKey, povCols) {
  return worldImplFor(presetKey).init3D(scenario, presetKey, povCols);
}

export function update3D(t, sim) {
  return worldImplFor(currentScenePreset).update3D(t, sim);
}

export function teardown3D() {
  return worldImplFor(currentScenePreset).teardown3D();
}
