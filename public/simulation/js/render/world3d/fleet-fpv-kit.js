/**
 * Fleet tactical FPV kit — shared camera / HUD math used by multiple scene presets.
 *
 * **Scope today:** Urban-quake (1 grid unit == 1 world unit) and Industrial (scaled grid → GLB xz).
 * **Meshes:** `createAgentMesh` → `./fleet-agents-mesh.js`. Wildfire can plug this kit + meshes when it gains POVs.
 *
 * @module fleet-fpv-kit
 */
import * as THREE from "three";

/** Shortest-path lerp on degrees (0–360). */
export function lerpAngleDeg(a, b, t) {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

/** Eye height in “urban grid units” (one cell tall == 1 world unit in Urban theatre). */
export function tacticalFpvAltitudeUrbanUnits(driver, t) {
  const id = driver.id.charCodeAt(0);
  let baseAlt;
  if (driver.type === "drone") {
    baseAlt = 0.6 + Math.sin(t * 1.0 + id) * 0.08 + Math.sin(t * 0.4 + id * 0.5) * 0.05;
    return Math.max(baseAlt, Number(driver._overflightAltitudeUnits) || 0);
  }
  if (driver.type === "balloon") {
    return 3.6 + Math.sin(t * 0.35 + id) * 0.18;
  }
  return 0.45;
}

export function tacticalFpvPhaseSeed(driver) {
  return driver.id.charCodeAt(0) * 0.13;
}

/** Pitch mixed into forward vector before normalize; scaled by `pitchScale` (Industrial cell size). */
export function tacticalFpvPitchScaled(driver, pitchScale) {
  const p = driver.type === "drone" ? -0.08 : driver.type === "balloon" ? -0.05 : 0.02;
  return p * pitchScale;
}

/**
 * Planar grid sample → world xz (continuous ix/iy). Urban: centers on cell (ix+0.5, iy+0.5).
 * @param {(ix: number, iy: number) => { x: number; z: number }} gridToWorldXZ
 */
export function tacticalFpvForwardVector(driver, prev, ix, iy, t, targetCell, gridToWorldXZ, pitchScale) {
  const phaseSeed = tacticalFpvPhaseSeed(driver);
  const pitch = tacticalFpvPitchScaled(driver, pitchScale);
  const dx = driver.location[0] - prev[0];
  const dy = driver.location[1] - prev[1];

  function deltaXZ(dix, diy) {
    const p0 = gridToWorldXZ(ix, iy);
    const p1 = gridToWorldXZ(ix + dix, iy + diy);
    return new THREE.Vector3(p1.x - p0.x, 0, p1.z - p0.z);
  }

  const fwd = new THREE.Vector3();
  if (Math.abs(dx) + Math.abs(dy) > 0.001) {
    const h = deltaXZ(dx, dy);
    fwd.set(h.x, pitch, h.z);
  } else if (targetCell) {
    const tx = targetCell[0] + 0.5 - (ix + 0.5);
    const ty = targetCell[1] + 0.5 - (iy + 0.5);
    const distToTarget = Math.hypot(tx, ty);
    if (distToTarget > 3) {
      const h = deltaXZ(tx, ty);
      fwd.set(h.x, pitch, h.z);
    } else {
      fwd.set(Math.cos(t * 0.3 + phaseSeed), pitch, Math.sin(t * 0.3 + phaseSeed));
    }
  } else {
    fwd.set(Math.cos(t * 0.3 + phaseSeed), pitch, Math.sin(t * 0.3 + phaseSeed));
  }
  fwd.normalize();
  return fwd;
}

export function tacticalFpvLookDistanceWorld(isAerial, pitchScale) {
  return pitchScale * (isAerial ? 6 : 4);
}

/**
 * World-space eye position for one FPV tick.
 * @param {object} opts
 * @param {number} [opts.groundY=0] — Industrial cement / datum; Urban uses 0.
 * @param {number} [opts.pitchScale=1] — Industrial `industrialCellSpan`; Urban 1.
 */
export function tacticalFpvEyeWorldPosition(ix, iy, driver, t, gridToWorldXZ, opts = {}) {
  const { groundY = 0, pitchScale = 1, headBobX = 0, headBobY = 0 } = opts;
  const p = gridToWorldXZ(ix + headBobX, iy);
  const altUrban = tacticalFpvAltitudeUrbanUnits(driver, t);
  const y = groundY + pitchScale * altUrban + headBobY * pitchScale;
  return new THREE.Vector3(p.x, y, p.z);
}

/** HUD strip — matches legacy Urban absolute altitude readout. */
export function tacticalFpvHudAltUrbanGrid(driver, t, headBobY) {
  return tacticalFpvAltitudeUrbanUnits(driver, t) + headBobY;
}

/** HUD strip — Industrial “equivalent grid units” above datum. */
export function tacticalFpvHudAltIndustrialRelative(driver, t, headBobY, groundY, pitchScale) {
  const y =
    groundY +
    pitchScale * tacticalFpvAltitudeUrbanUnits(driver, t) +
    headBobY * pitchScale;
  return (y - groundY) / Math.max(pitchScale, 1e-6);
}
