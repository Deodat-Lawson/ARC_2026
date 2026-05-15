"use client";

import { useSyncExternalStore } from "react";
import { Vector3 } from "three";

/**
 * Tiny module-level state for the hero, with two parts:
 *
 *   1. POV target — reactive (drives camera mode + HUD layout).
 *      Subscribed via useSyncExternalStore so HUD/DOM and R3F components
 *      both see the same value without prop drilling.
 *
 *   2. Live asset transforms — non-reactive mutable refs that DroneSwarm /
 *      DogTeam write into each frame and CameraRig / AssetPicker / CommBeams
 *      read. Per-frame mutation, no React notifications.
 */

export type AssetId = "lead" | "perception" | "relay" | "dog1" | "dog2";
export type PovTarget = "cinematic" | AssetId;

// ----- POV target (reactive) -----

let _povTarget: PovTarget = "cinematic";
const _listeners = new Set<() => void>();

export function getPovTarget(): PovTarget {
  return _povTarget;
}

export function setPovTarget(t: PovTarget): void {
  if (_povTarget === t) return;
  _povTarget = t;
  _listeners.forEach((l) => l());
}

/** Valid POV target ids — used to validate query-param values. */
const VALID_POV_TARGETS: ReadonlySet<PovTarget> = new Set([
  "cinematic",
  "lead",
  "perception",
  "relay",
  "dog1",
  "dog2",
] as PovTarget[]);

/**
 * Hard-navigate to a different POV via the URL query param. Reload triggers
 * a fresh React tree, fresh R3F canvas, fresh component mounts — bypassing
 * the in-page state-transition bugs that caused the camera to read stale
 * ASSET_POSITIONS or wrong aspect-ratio on POV switch.
 *
 * UX cost: ~2 seconds of HeroFallback while GLBs reload. Use only when the
 * in-page approach proves unreliable.
 */
export function setPovTargetViaUrl(t: PovTarget): void {
  if (typeof window === "undefined") {
    setPovTarget(t);
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (t === "cinematic") {
    params.delete("pov");
  } else {
    params.set("pov", t);
  }
  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.location.assign(url);
}

/**
 * Read the POV target from the URL `?pov=` query param. Returns "cinematic"
 * if the param is absent or invalid. Call this on mount to restore POV
 * after a hard-refresh navigation.
 */
export function getPovFromUrl(): PovTarget {
  if (typeof window === "undefined") return "cinematic";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("pov");
  if (!raw) return "cinematic";
  return VALID_POV_TARGETS.has(raw as PovTarget)
    ? (raw as PovTarget)
    : "cinematic";
}

function subscribe(l: () => void): () => void {
  _listeners.add(l);
  return () => {
    _listeners.delete(l);
  };
}

/** React hook for the current POV target. */
export function usePovTarget(): PovTarget {
  return useSyncExternalStore(subscribe, getPovTarget, getPovTarget);
}

// ----- Live asset transforms (non-reactive, per-frame mutable) -----

export const ASSET_POSITIONS: Record<AssetId, Vector3> = {
  lead: new Vector3(),
  perception: new Vector3(),
  relay: new Vector3(),
  dog1: new Vector3(),
  dog2: new Vector3(),
};

/** Yaw rotation (radians) — Y-axis only, set by the asset's heading. */
export const ASSET_YAWS: Record<AssetId, number> = {
  lead: 0,
  perception: 0,
  relay: 0,
  dog1: 0,
  dog2: 0,
};

// ----- POV camera offsets per asset (in asset-local space) -----

export type PovOffset = {
  /** Eye position in asset-local space. Drones: under nose at gimbal. Dogs: at sensor head. */
  eye: [number, number, number];
  /** How far ahead the lookAt point sits (in asset-forward distance) */
  lookAhead: number;
  /** Camera tilt in radians. Negative = look down. */
  tilt: number;
  /** Field of view in degrees while in this FPV */
  fov: number;
  /** Subtle motion bob amplitude added to camera Y (gait for dogs, vibration for drones) */
  bobAmp: number;
  /** Bob frequency in Hz */
  bobHz: number;
  /** Idle scan yaw amplitude in radians (peak left/right swing of the gimbal/head) */
  scanYawAmp: number;
  /** Idle scan yaw frequency in Hz */
  scanYawHz: number;
  /** Idle scan pitch amplitude in radians (peak up/down) */
  scanPitchAmp: number;
  /** Idle scan pitch frequency in Hz */
  scanPitchHz: number;
};

export const POV_OFFSETS: Record<AssetId, PovOffset> = {
  // All FoVs are widened relative to cinematic (38°) so each FPV reads as
  // "looking around the world" rather than "telephoto on the target."
  //
  // Drones — gimbal-cam under the nose. Slow deliberate sweeps read as the
  // gimbal scanning the scene. Dogs use faster, smaller swings to read as
  // head turns while running.
  lead: { eye: [0, -0.05, 0.5], lookAhead: 6, tilt: -0.22, fov: 70, bobAmp: 0.02, bobHz: 3.0, scanYawAmp: 0.35, scanYawHz: 0.11, scanPitchAmp: 0.08, scanPitchHz: 0.07 },
  perception: { eye: [0, -0.05, 0.5], lookAhead: 6, tilt: -0.18, fov: 70, bobAmp: 0.02, bobHz: 3.0, scanYawAmp: 0.4, scanYawHz: 0.13, scanPitchAmp: 0.1, scanPitchHz: 0.09 },
  // Overseer — wide overview lens, slowest widest sweep.
  relay: { eye: [0, -0.05, 0.4], lookAhead: 14, tilt: -0.4, fov: 90, bobAmp: 0.02, bobHz: 2.5, scanYawAmp: 0.45, scanYawHz: 0.07, scanPitchAmp: 0.06, scanPitchHz: 0.05 },
  // Dogs — head-cam, raised above the dog's head height so we clear debris.
  dog1: { eye: [0, 0.95, 0.55], lookAhead: 6, tilt: -0.05, fov: 85, bobAmp: 0.04, bobHz: 5.0, scanYawAmp: 0.28, scanYawHz: 0.18, scanPitchAmp: 0.09, scanPitchHz: 0.13 },
  dog2: { eye: [0, 0.95, 0.55], lookAhead: 6, tilt: -0.05, fov: 85, bobAmp: 0.04, bobHz: 5.0, scanYawAmp: 0.3, scanYawHz: 0.21, scanPitchAmp: 0.09, scanPitchHz: 0.15 },
};

/**
 * Per-asset POV focal points. Each is placed in airspace that's verified
 * clear of all building geometry (apartment x∈[-22,-2], mansion x∈[3,23],
 * mid-multistory now at x∈[-26,-6], mid-apartment x∈[-6,14] z∈[-52,-32]).
 *
 * Drone focals sit at plaza-level Y so airborne assets look forward-and-down
 * at the rescue scene. Dog focals are at near-ground Y so ground assets look
 * forward through the alley.
 *
 * All focal points are in the clear central alley (x∈[-2, 3]) at z above -32.
 */
export type PovLookOverride = {
  fromT: number;
  lookAt: [number, number, number];
};

export const POV_LOOK_OVERRIDES: Record<AssetId, PovLookOverride | null> = {
  // Lead drone: looks at point just past T-01 in the alley
  lead: { fromT: 0, lookAt: [-1, 1.5, -26] },
  // Perception drone: looks at point just past T-02 in the alley
  perception: { fromT: 0, lookAt: [2, 1.5, -30] },
  // Overseer: looks at the plaza center between both survivors
  relay: { fromT: 0, lookAt: [0.5, 2, -26] },
  // D-01 dog: looks forward into the deep alley past T-01
  dog1: { fromT: 0, lookAt: [0, 1, -30] },
  // D-02 dog: looks forward into the deep alley past T-02
  dog2: { fromT: 0, lookAt: [1, 1, -31] },
};

// ----- Display metadata -----

export const ASSET_META: Record<
  AssetId,
  { label: string; role: string; kind: "drone" | "dog" }
> = {
  lead: { label: "A-01", role: "LEAD · SURVEY", kind: "drone" },
  perception: { label: "A-02", role: "PERCEPTION", kind: "drone" },
  relay: { label: "A-03", role: "OVERSEER · ↑CMD", kind: "drone" },
  dog1: { label: "D-01", role: "SCOUT · →T-01", kind: "dog" },
  dog2: { label: "D-02", role: "SUPPORT · →T-02", kind: "dog" },
};

export const ALL_ASSETS: AssetId[] = ["lead", "perception", "relay", "dog1", "dog2"];
