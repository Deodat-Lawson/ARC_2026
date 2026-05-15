"use client";

import { useSyncExternalStore } from "react";
import { Vector3 } from "three";
import { resetMissionClock } from "./missionTimeline";

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
  // Restart the mission clock whenever the user enters an FPV so the loop
  // plays from the beginning (NAVIGATE phase) every time. This makes each
  // POV deterministic — same click, same starting view, full sequence
  // visible from that asset's perspective.
  if (t !== "cinematic") {
    resetMissionClock();
  }
  _listeners.forEach((l) => l());
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
};

export const POV_OFFSETS: Record<AssetId, PovOffset> = {
  // All FoVs are widened relative to cinematic (38°) so each FPV reads as
  // "looking around the world" rather than "telephoto on the target."
  //
  // Drones — gimbal-cam under the nose.
  lead: { eye: [0, -0.1, 0.68], lookAhead: 7, tilt: -0.2, fov: 74, bobAmp: 0.018, bobHz: 3.2 },
  perception: { eye: [0, -0.08, 0.62], lookAhead: 6.5, tilt: -0.15, fov: 78, bobAmp: 0.022, bobHz: 3.5 },
  // Overseer — wide overview lens.
  relay: { eye: [0, -0.05, 0.42], lookAhead: 16, tilt: -0.42, fov: 92, bobAmp: 0.015, bobHz: 2.2 },
  // Dogs — head-cam, raised above the dog's head height so we clear debris.
  dog1: { eye: [0, 0.72, 0.5], lookAhead: 5.5, tilt: -0.03, fov: 88, bobAmp: 0.055, bobHz: 5.4 },
  dog2: { eye: [0, 0.72, 0.5], lookAhead: 5.5, tilt: -0.03, fov: 88, bobAmp: 0.052, bobHz: 5.1 },
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

export type SensorProfile = {
  feed: string;
  primary: string;
  target: "T-01" | "T-02" | "BOTH";
  thermal: number;
  acoustic: number;
  vibration: number;
  link: string;
};

export const SENSOR_PROFILES: Record<AssetId, SensorProfile> = {
  lead: {
    feed: "EO/IR gimbal",
    primary: "thermal contour",
    target: "T-01",
    thermal: 0.86,
    acoustic: 0.42,
    vibration: 0.2,
    link: "MESH 5/5",
  },
  perception: {
    feed: "stereo + audio",
    primary: "audio triangulation",
    target: "T-02",
    thermal: 0.62,
    acoustic: 0.78,
    vibration: 0.48,
    link: "MESH 4/5",
  },
  relay: {
    feed: "wide relay cam",
    primary: "mesh coverage",
    target: "BOTH",
    thermal: 0.54,
    acoustic: 0.38,
    vibration: 0.22,
    link: "UPLINK 98%",
  },
  dog1: {
    feed: "head stereo",
    primary: "near-field vibration",
    target: "T-01",
    thermal: 0.46,
    acoustic: 0.63,
    vibration: 0.84,
    link: "MESH 4/5",
  },
  dog2: {
    feed: "head stereo",
    primary: "void audio",
    target: "T-02",
    thermal: 0.52,
    acoustic: 0.73,
    vibration: 0.76,
    link: "MESH 4/5",
  },
};
