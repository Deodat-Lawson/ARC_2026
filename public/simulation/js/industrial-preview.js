/**
 * Standalone orbit preview → passes height-calibration HUD (see industrial-preview.html).
 */
import {
  initIndustrialStandalonePreview,
  teardown3D,
} from "./render/world3d/industrial.js";

const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("industrialCanvas"));
if (!canvas) throw new Error("#industrialCanvas missing");

initIndustrialStandalonePreview(canvas, document.body);

window.addEventListener("beforeunload", () => {
  teardown3D();
});
