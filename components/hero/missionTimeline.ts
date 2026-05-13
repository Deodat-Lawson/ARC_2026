"use client";

/**
 * Single source of truth for the rescue-mission timeline.
 *
 * Everything that animates with the hero — drones, camera, comm beams, scan
 * beam, detection HUD, DOM telemetry — reads the elapsed mission time from
 * `getMissionTime()` and derives its state from these definitions.
 *
 * The mission is a seamless 12-second loop with 6 named phases. Each animated
 * subject defines a waypoint per phase; we lerp between adjacent waypoints
 * using a smootherstep ease so motion arrives cleanly into each beat.
 */

import { Vector3 } from "three";

export const LOOP_SECONDS = 12;

/**
 * Phases. Times are start-time of each phase in seconds within the loop.
 * The final implicit phase (RELAY at t=10) blends back into APPROACH at t=12.
 */
export const PHASES = [
  { name: "APPROACH", t: 0 },
  { name: "DEPLOY", t: 2 },
  { name: "SCAN", t: 4 },
  { name: "DETECT", t: 6 },
  { name: "CONFIRM", t: 8 },
  { name: "RELAY", t: 10 },
] as const;

export type PhaseName = (typeof PHASES)[number]["name"];

/** Shared monotonic mission clock, in seconds. */
const START = typeof performance !== "undefined" ? performance.now() : 0;
export function getMissionTime(): number {
  return ((typeof performance !== "undefined" ? performance.now() : 0) - START) / 1000;
}
export function getLoopTime(): number {
  return getMissionTime() % LOOP_SECONDS;
}

/** Smootherstep — C2-continuous easing. */
export function smootherstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Given a loop-time and a phase-indexed array of values, return the
 * interpolated value at the current point in the loop. The last → first
 * wrap closes the loop seamlessly.
 */
export function phaseLerp<T>(
  loopT: number,
  values: T[],
  lerp: (a: T, b: T, t: number) => T,
): T {
  // Find which segment of the loop we're in
  for (let i = 0; i < PHASES.length; i++) {
    const start = PHASES[i].t;
    const end = i === PHASES.length - 1 ? LOOP_SECONDS : PHASES[i + 1].t;
    if (loopT >= start && loopT < end) {
      const segT = (loopT - start) / (end - start);
      const a = values[i];
      const b = values[(i + 1) % PHASES.length];
      return lerp(a, b, smootherstep(segT));
    }
  }
  return values[0];
}

export function lerpVec3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Get current phase index from loop time. */
export function currentPhaseIndex(loopT: number): number {
  for (let i = PHASES.length - 1; i >= 0; i--) {
    if (loopT >= PHASES[i].t) return i;
  }
  return 0;
}

export function currentPhaseName(loopT: number): PhaseName {
  return PHASES[currentPhaseIndex(loopT)].name;
}

// ============================================================================
// Drone waypoints — one position per phase per drone
// ============================================================================

/**
 * Waypoint ORDER matches PHASES order. The 7th value (wrap) auto-loops back
 * to the first via phaseLerp.
 *
 * Coordinate system reminder: camera-forward is -z; ground is y=0; the
 * disaster zone occupies z=-10 to z=-80.
 */
export const DRONE_WAYPOINTS: Record<
  "lead" | "perception" | "relay",
  [number, number, number][]
> = {
  // A-01 LEAD — descends into the rubble to scan, holds for detect/confirm,
  // then climbs back out for relay/approach.
  lead: [
    [0, 11, 8], //   APPROACH
    [-2, 9, -4], //  DEPLOY
    [-4, 6, -12], // SCAN (low over rubble)
    [-4, 5.5, -13], // DETECT
    [-4, 5.5, -13], // CONFIRM (hold)
    [-3, 7, -10], //  RELAY (rise)
  ],
  // A-02 PERCEPTION — starts wide, converges on survivor at confirm phase.
  perception: [
    [4, 10, 9], //   APPROACH
    [5, 8, -2], //   DEPLOY
    [6, 7, -8], //   SCAN (holds wide)
    [3, 6.5, -10], //  DETECT (closing)
    [-1, 6, -12], //  CONFIRM (arrived next to lead)
    [1, 7, -9], //    RELAY
  ],
  // A-03 RELAY — high overwatch, slow drift, maintains comm link to command.
  relay: [
    [-3, 12, 10], // APPROACH
    [0, 14, -2], //  DEPLOY (climb to overwatch)
    [1, 14, -6], //  SCAN
    [2, 14.5, -8], // DETECT
    [3, 14, -7], //   CONFIRM
    [2, 15, -6], //   RELAY (highest point, broadcasts up)
  ],
};

// ============================================================================
// Camera keyframes — cinematic mission cuts
// ============================================================================

export const CAMERA_KEYS: { pos: [number, number, number]; look: [number, number, number] }[] = [
  // APPROACH — wide aerial behind drones, looking forward into the zone
  { pos: [0, 10, 22], look: [0, 7, -2] },
  // DEPLOY — follow lead from behind, mid-altitude
  { pos: [-1, 9, 8], look: [-2, 6, -10] },
  // SCAN — low, focused on rubble below lead drone
  { pos: [1, 7, 2], look: [-4, 3, -14] },
  // DETECT — pull back to see both lead + perception converging
  { pos: [5, 8, -2], look: [-3, 5, -13] },
  // CONFIRM — tight 3/4 on detection spot
  { pos: [-1, 7, -6], look: [-4, 4, -14] },
  // RELAY — rise to show all 3 drones + relay broadcast upward
  { pos: [4, 11, -2], look: [-1, 13, -8] },
];

// ============================================================================
// Comm events — packets traveling between drones at specific times
// ============================================================================

export type CommLink = "lead-perception" | "lead-relay" | "perception-relay" | "relay-command";
export type CommKind = "telemetry" | "alert" | "command";

/**
 * A comm event runs from `t` to `t + duration`. During that window a packet
 * travels visually along the link. Multiple events can overlap.
 */
export type CommEvent = {
  t: number;
  duration: number;
  link: CommLink;
  kind: CommKind;
  /** Short log line shown in the HUD comm log */
  log: string;
};

export const COMM_EVENTS: CommEvent[] = [
  { t: 0.6, duration: 1.0, link: "lead-perception", kind: "telemetry", log: "A-01 → A-02   formation handoff" },
  { t: 1.0, duration: 1.0, link: "perception-relay", kind: "telemetry", log: "A-02 → A-03   telemetry · MESH 5/5" },
  { t: 2.4, duration: 1.2, link: "lead-relay", kind: "telemetry", log: "A-01 → A-03   role assign · SURVEY" },
  { t: 4.2, duration: 1.4, link: "lead-perception", kind: "telemetry", log: "A-01 → A-02   sector 14-D · sweep" },
  { t: 6.1, duration: 1.0, link: "lead-perception", kind: "alert", log: "A-01 → A-02   ALERT · sub-acoustic 4.2σ" },
  { t: 7.0, duration: 1.2, link: "lead-perception", kind: "alert", log: "A-02 → A-01   vectoring · ETA 1.8s" },
  { t: 8.4, duration: 0.9, link: "lead-perception", kind: "telemetry", log: "A-01 → A-02   lock confirmed · 0.87" },
  { t: 9.6, duration: 1.0, link: "lead-relay", kind: "alert", log: "A-01 → A-03   relay priority HIGH" },
  { t: 10.3, duration: 1.5, link: "relay-command", kind: "command", log: "A-03 → CMD    SitRep · T-01 lock · 87%" },
];

export function commLinkEndpoints(
  link: CommLink,
  lead: [number, number, number],
  perception: [number, number, number],
  relay: [number, number, number],
): [[number, number, number], [number, number, number]] {
  switch (link) {
    case "lead-perception":
      return [lead, perception];
    case "lead-relay":
      return [lead, relay];
    case "perception-relay":
      return [perception, relay];
    case "relay-command":
      // Command is conceptual — beam shoots up off-screen
      return [relay, [relay[0], relay[1] + 30, relay[2]]];
  }
}

// Useful color per kind
export const COMM_COLORS: Record<CommKind, string> = {
  telemetry: "#5dffb4", // accent green
  alert: "#ffd95d", // warning yellow
  command: "#ff7a40", // command orange
};

// Helper to fill a target Vector3 from waypoint lerp (avoids allocation in hot loops)
export function applyWaypointLerp(
  out: Vector3,
  waypoints: [number, number, number][],
  loopT: number,
) {
  for (let i = 0; i < PHASES.length; i++) {
    const start = PHASES[i].t;
    const end = i === PHASES.length - 1 ? LOOP_SECONDS : PHASES[i + 1].t;
    if (loopT >= start && loopT < end) {
      const segT = smootherstep((loopT - start) / (end - start));
      const a = waypoints[i];
      const b = waypoints[(i + 1) % PHASES.length];
      out.set(
        a[0] + (b[0] - a[0]) * segT,
        a[1] + (b[1] - a[1]) * segT,
        a[2] + (b[2] - a[2]) * segT,
      );
      return;
    }
  }
  const a = waypoints[0];
  out.set(a[0], a[1], a[2]);
}

/** Survivor anchor — where the detection HUD locks on. */
export const SURVIVOR_POS: [number, number, number] = [-4, 0.5, -14];
