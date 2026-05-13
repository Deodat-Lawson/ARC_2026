"use client";

/**
 * Single source of truth for the rescue-mission timeline.
 *
 * The mission is a seamless 15-second loop with 6 named phases that tell a
 * real rescue arc:
 *
 *   NAVIGATE  — flythrough into the disaster zone, dogs deploy
 *   IDENTIFY  — drones sweep, find T-01 (rubble) then T-02 (building)
 *   DETERMINE — priority calc, dispatch plan broadcast
 *   DISPATCH  — D-01 → T-01, D-02 → T-02
 *   RESCUE    — dogs arrive, ground-confirm vital signs
 *   REPORT    — overseer uplinks dual SitRep to command, loop resets
 *
 * Everything time-driven reads from `getMissionTime()` and derives state
 * from the data below. Adding a beat = adding a row.
 */

import { Vector3 } from "three";

export const LOOP_SECONDS = 22;

// Longer phase durations so motion feels less rushed and each beat has
// breathing room. Total 22s, distributed:
//   NAVIGATE  3s  — drones arrive, dogs deploy
//   IDENTIFY  4s  — sweep + sequential detection (T-01 then T-02)
//   DETERMINE 3s  — priority calc + dispatch plan
//   DISPATCH  3s  — dogs vector out to their assignments
//   RESCUE    5s  — dogs travel + ground-confirm vital signs
//   REPORT    4s  — overseer uplinks SitRep, mission state held
export const PHASES = [
  { name: "NAVIGATE", t: 0 },
  { name: "IDENTIFY", t: 3 },
  { name: "DETERMINE", t: 7 },
  { name: "DISPATCH", t: 10 },
  { name: "RESCUE", t: 13 },
  { name: "REPORT", t: 18 },
] as const;

export type PhaseName = (typeof PHASES)[number]["name"];

// `START` is mutable so `resetMissionClock()` can snap the loop back to t=0.
// Called whenever the user enters an FPV so the mission timeline restarts
// from NAVIGATE every time — each POV is now consistent regardless of when
// the user clicked it.
let START = typeof performance !== "undefined" ? performance.now() : 0;
export function getMissionTime(): number {
  return ((typeof performance !== "undefined" ? performance.now() : 0) - START) / 1000;
}
export function getLoopTime(): number {
  return getMissionTime() % LOOP_SECONDS;
}
export function resetMissionClock(): void {
  START = typeof performance !== "undefined" ? performance.now() : 0;
}

export function smootherstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function currentPhaseIndex(loopT: number): number {
  for (let i = PHASES.length - 1; i >= 0; i--) {
    if (loopT >= PHASES[i].t) return i;
  }
  return 0;
}

export function currentPhaseName(loopT: number): PhaseName {
  return PHASES[currentPhaseIndex(loopT)].name;
}

export function applyWaypointLerp(
  out: Vector3,
  waypoints: [number, number, number][],
  loopT: number,
) {
  for (let i = 0; i < PHASES.length; i++) {
    const start = PHASES[i].t;
    const end = i === PHASES.length - 1 ? LOOP_SECONDS : PHASES[i + 1].t;
    if (loopT >= start && loopT < end) {
      // Final phase HOLDS at its waypoint — don't wrap back to NAVIGATE.
      // Without this the dogs/drones walked backwards during REPORT, which
      // looked broken in FPV. With it, the mission visibly ends at the
      // rescue zone and the loop just snaps at t=LOOP_SECONDS.
      if (i === PHASES.length - 1) {
        const a = waypoints[i];
        out.set(a[0], a[1], a[2]);
        return;
      }
      const segT = smootherstep((loopT - start) / (end - start));
      const a = waypoints[i];
      const b = waypoints[i + 1];
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

// ============================================================================
// Survivors — two trapped people the cluster is rescuing
// ============================================================================

export type Survivor = {
  id: "T-01" | "T-02";
  /** World position of the trapped person */
  position: [number, number, number];
  /** Survival probability shown in the HUD lock */
  probability: number;
  /** When the drones first detect this survivor (within the IDENTIFY phase) */
  identifyAtT: number;
  /** When the assigned ground unit reaches them (within RESCUE phase) */
  rescuedAtT: number;
  /** Which dog handles this survivor */
  assignedDog: "dog1" | "dog2";
};

/**
 * Two survivors placed in the deep central alley.
 *
 * The hero buildings are wider than initially assumed — using ±10 conservative
 * footprints:
 *   apartment hero (-12,-16): x∈[-22,-2], z∈[-26,-6]
 *   mansion hero   ( 13,-20): x∈[  3,23], z∈[-30,-10]
 *   mid-multistory (-16,-34): x∈[-26,-6], z∈[-44,-24]   (moved out of alley)
 *   mid-apartment  (  4,-42): x∈[ -6,14], z∈[-52,-32]
 *
 * The CENTRAL ALLEY at x∈[-2, 3] is clear of all buildings from z=-6 down to
 * z=-32. Both survivors live in here at ground level. Detection times are
 * staggered (1.2s apart) so they're never identified simultaneously.
 */
export const SURVIVORS: Survivor[] = [
  {
    id: "T-01",
    position: [-1, 0.5, -24],
    probability: 87,
    identifyAtT: 4.5, // mid-IDENTIFY phase
    rescuedAtT: 15, // mid-RESCUE phase
    assignedDog: "dog1",
  },
  {
    id: "T-02",
    position: [2, 0.5, -28],
    probability: 71,
    identifyAtT: 6.4, // late IDENTIFY phase
    rescuedAtT: 16.8, // later in RESCUE
    assignedDog: "dog2",
  },
];

// ============================================================================
// Asset waypoints — one position per phase, per asset
// ============================================================================

/**
 * Hard-coded paths. Building footprints (±10 conservative):
 *
 *   apartment hero (-12, 0, -16): blocks x∈[-22,-2], z∈[-26,-6]
 *   mansion hero   ( 13, 0, -20): blocks x∈[  3,23], z∈[-30,-10]
 *   mid-multistory (-16, 0, -34): blocks x∈[-26,-6], z∈[-44,-24]
 *   mid-mansion    ( 22, 0, -38): blocks x∈[ 12,32], z∈[-48,-28]
 *   mid-apartment  (  4, 0, -42): blocks x∈[ -6,14], z∈[-52,-32]
 *
 * IMPORTANT: every per-phase waypoint AND every loop-wrap segment
 * (REPORT → NAVIGATE) is verified clear. The wrap segment is what made the
 * old layout flicker — dogs at (-1,-22)/(2,-26) lerping back to staging at
 * (16,18)/(18,20) cut diagonally THROUGH the mansion.
 *
 * Fix: assets walk a straight column down the central alley. Lead drone +
 * D-01 hold x=-1 throughout. Perception drone + D-02 hold x=2 throughout.
 * The loop-wrap is then pure z motion, never crossing any building.
 */
export const ASSET_WAYPOINTS: Record<
  "lead" | "perception" | "relay" | "dog1" | "dog2",
  [number, number, number][]
> = {
  // A-01 LEAD — straight column at x=-1 (east of apartment x≤-2). y varies
  // for cinematic descent over the rescue zone.
  lead: [
    [-1, 11, 18], //  NAVIGATE — high front
    [-1, 7, 6], //    IDENTIFY — descending into the alley
    [-1, 8, -10], //  DETERMINE — over plaza
    [-1, 9, -18], //  DISPATCH — moving toward T-01
    [-1, 9, -23], //  RESCUE — overwatch above T-01 (-1, 0.5, -24)
    [-1, 10, -16], // REPORT
  ],

  // A-02 PERCEPTION — straight column at x=2 (west of mansion x≥3).
  perception: [
    [2, 11, 20], //   NAVIGATE — high front
    [2, 7, 6], //     IDENTIFY — descending
    [2, 7, -10], //   DETERMINE — over plaza
    [2, 7, -20], //   DISPATCH — moving toward T-02
    [2, 7, -28], //   RESCUE — directly above T-02 (2, 0.5, -28)
    [2, 9, -20], //   REPORT
  ],

  // A-03 OVERSEER — high altitude, always above building heights, doesn't
  // conflict with buildings regardless of (x,z).
  relay: [
    [-10, 18, 20], //  NAVIGATE
    [-8, 18, 8], //    IDENTIFY
    [-6, 18, 0], //    DETERMINE
    [-4, 18, -6], //   DISPATCH
    [-2, 18, -10], //  RESCUE
    [-4, 19, -4], //   REPORT — closer to NAVIGATE so wrap is short
  ],

  // D-01 SCOUT — straight column at x=-1 (east of apartment x≤-2).
  // Wrap segment from RESCUE (-1,-22) → NAVIGATE (-1, 18) is pure +z motion,
  // x=-1 is in the clear central alley all the way through.
  dog1: [
    [-1, 0, 18], //   NAVIGATE — at alley entrance north
    [-1, 0, 8], //    IDENTIFY
    [-1, 0, -2], //   DETERMINE
    [-1, 0, -12], //  DISPATCH
    [-1, 0, -22], //  RESCUE — 2m north of T-01 (-1, 0.5, -24)
    [-1, 0, -22], //  REPORT
  ],

  // D-02 SUPPORT — straight column at x=2 (west of mansion x≥3).
  // Wrap segment from RESCUE (2,-26) → NAVIGATE (2, 20) is pure +z motion.
  dog2: [
    [2, 0, 20], //    NAVIGATE
    [2, 0, 10], //    IDENTIFY
    [2, 0, 0], //     DETERMINE
    [2, 0, -10], //   DISPATCH
    [2, 0, -26], //   RESCUE — 2m north of T-02 (2, 0.5, -28)
    [2, 0, -26], //   REPORT
  ],
};

// Backwards-compat alias
export const DRONE_WAYPOINTS = ASSET_WAYPOINTS;

// ============================================================================
// Camera keyframes — cinematic mission cuts
// ============================================================================

/**
 * Cinematic camera keyframes. Each position is verified clear of building
 * geometry. Crucially: every segment BETWEEN keyframes is also verified,
 * because the camera lerps from one to the next.
 *
 * Past versions had RESCUE→REPORT transitioning through the mansion footprint
 * (x∈[3,23], z∈[-30,-10], y∈[0,13]) which gave the "camera in a mesh"
 * artifact when exiting FPV during REPORT phase. Fix: RESCUE moved to the
 * clear central alley at x=2 (west of mansion's x≥3 edge), REPORT lifted to
 * y=16 (above mansion's y=13 top), DETERMINE lifted to y=15.
 */
export const CAMERA_KEYS: { pos: [number, number, number]; look: [number, number, number] }[] = [
  // NAVIGATE — wide aerial entry showing the disaster zone
  { pos: [0, 13, 28], look: [0, 5, -10] },
  // IDENTIFY — swoop low in front of the buildings, looking deep at T-01
  { pos: [1, 7, 6], look: [-1, 2, -24] },
  // DETERMINE — pull right + up, ABOVE mansion's roof so both survivors frame
  { pos: [6, 15, -2], look: [1, 2, -26] },
  // DISPATCH — north of all buildings (z=2 > -10), tracking dogs entering
  { pos: [5, 5, 2], look: [1, 1, -20] },
  // RESCUE — in the central alley (x=2 outside mansion x≥3) at altitude 5
  { pos: [2, 5, -8], look: [1, 1.5, -26] },
  // REPORT — alley x=2 lifted to y=16 (above all building tops), final SitRep
  { pos: [2, 16, -14], look: [0, 6, -26] },
];

// ============================================================================
// Comm events — packets traveling between assets
// ============================================================================

export type CommLink =
  | "lead-perception"
  | "lead-relay"
  | "perception-relay"
  | "relay-command"
  | "lead-dog1"
  | "perception-dog2"
  | "dog1-dog2"
  | "dog1-relay"
  | "dog2-relay";

export type CommKind = "telemetry" | "alert" | "command" | "dispatch";

export type CommEvent = {
  t: number;
  duration: number;
  link: CommLink;
  kind: CommKind;
  log: string;
};

export const COMM_EVENTS: CommEvent[] = [
  // NAVIGATE (0-3) — ingress chatter
  { t: 0.5, duration: 1.0, link: "lead-perception", kind: "telemetry", log: "A-01 → A-02   formation lock · sector 14" },
  { t: 1.3, duration: 1.0, link: "lead-relay", kind: "telemetry", log: "A-01 → A-03   uplink to CMD ready" },
  { t: 2.0, duration: 1.0, link: "dog1-dog2", kind: "telemetry", log: "D-01 ↔ D-02   ground mesh online" },
  { t: 2.6, duration: 0.9, link: "perception-relay", kind: "telemetry", log: "A-02 → A-03   telemetry · MESH 5/5" },

  // IDENTIFY (3-7) — both targets detected
  { t: 3.5, duration: 1.0, link: "lead-perception", kind: "telemetry", log: "A-01 → A-02   sweep · sector 14-D" },
  { t: 4.5, duration: 1.2, link: "lead-relay", kind: "alert", log: "A-01 → A-03   ALERT · T-01 detected · 4.2σ" },
  { t: 6.4, duration: 1.2, link: "perception-relay", kind: "alert", log: "A-02 → A-03   ALERT · T-02 detected · 3.1σ" },

  // DETERMINE (7-10) — priority calculation + dispatch plan
  { t: 7.6, duration: 1.2, link: "lead-relay", kind: "telemetry", log: "A-01 → A-03   priority calc · T-01 > T-02" },
  { t: 8.8, duration: 1.2, link: "relay-command", kind: "command", log: "A-03 → ALL    dispatch plan · D-01→T-01 · D-02→T-02" },

  // DISPATCH (10-13) — dogs vectored
  { t: 10.4, duration: 1.2, link: "lead-dog1", kind: "dispatch", log: "A-01 → D-01   DISPATCH · vector to T-01" },
  { t: 11.0, duration: 1.2, link: "perception-dog2", kind: "dispatch", log: "A-02 → D-02   DISPATCH · vector to T-02" },

  // RESCUE (13-18) — ground confirmations
  { t: 14.5, duration: 1.0, link: "dog1-relay", kind: "telemetry", log: "D-01 → A-03   ground +  · T-01 vital sign +" },
  { t: 15.4, duration: 1.0, link: "lead-perception", kind: "telemetry", log: "A-01 → A-02   T-01 ground lock · 87%" },
  { t: 16.3, duration: 1.0, link: "dog2-relay", kind: "telemetry", log: "D-02 → A-03   ground +  · T-02 vital sign +" },
  { t: 17.2, duration: 1.0, link: "perception-relay", kind: "telemetry", log: "A-02 → A-03   T-02 ground lock · 71%" },

  // REPORT (18-22) — final uplink
  { t: 18.6, duration: 1.6, link: "relay-command", kind: "command", log: "A-03 → CMD    SitRep · 2 lock · D-01 D-02 in attendance" },
  { t: 20.4, duration: 1.0, link: "lead-relay", kind: "telemetry", log: "A-01 → A-03   mission state · RESCUE-IN-PROGRESS" },
];

export function commLinkEndpoints(
  link: CommLink,
  lead: [number, number, number],
  perception: [number, number, number],
  relay: [number, number, number],
  dog1: [number, number, number],
  dog2: [number, number, number],
): [[number, number, number], [number, number, number]] {
  // Slight head-height offset so links to dogs don't terminate at the ground
  const d1Head: [number, number, number] = [dog1[0], dog1[1] + 0.7, dog1[2]];
  const d2Head: [number, number, number] = [dog2[0], dog2[1] + 0.7, dog2[2]];

  switch (link) {
    case "lead-perception":
      return [lead, perception];
    case "lead-relay":
      return [lead, relay];
    case "perception-relay":
      return [perception, relay];
    case "lead-dog1":
      return [lead, d1Head];
    case "perception-dog2":
      return [perception, d2Head];
    case "dog1-dog2":
      return [d1Head, d2Head];
    case "dog1-relay":
      return [d1Head, relay];
    case "dog2-relay":
      return [d2Head, relay];
    case "relay-command":
      return [relay, [relay[0], relay[1] + 30, relay[2]]];
  }
}

export const COMM_COLORS: Record<CommKind, string> = {
  telemetry: "#5dffb4",
  alert: "#ffd95d",
  command: "#ff7a40",
  dispatch: "#5d9bff",
};

/** Backwards-compat — points at T-01 (the primary survivor under rubble). */
export const SURVIVOR_POS: [number, number, number] = SURVIVORS[0].position;

// ============================================================================
// Narration — short plain-English beats describing what's happening NOW
// ============================================================================

export type NarrationTone = "neutral" | "alert" | "success" | "command";

export type NarrationBeat = {
  /** Loop time (s) when this beat becomes the current narration */
  fromT: number;
  /** One-line description shown as a cinematic subtitle */
  text: string;
  /** Slightly more detail / context shown smaller beneath the headline */
  sub?: string;
  /** Color tone — drives the subtitle accent color */
  tone?: NarrationTone;
  /** Which assets/targets are "active" for this beat (drives HUD highlight) */
  focus?: ("lead" | "perception" | "relay" | "dog1" | "dog2" | "T-01" | "T-02")[];
};

export const NARRATION_BEATS: NarrationBeat[] = [
  {
    fromT: 0,
    text: "Arriving at sector 14",
    sub: "Cluster ingressing · building digital twin",
    tone: "neutral",
  },
  {
    fromT: 3,
    text: "Sweeping the rubble for life signs",
    sub: "A-01 acoustic · A-02 thermal · ground mesh online",
    tone: "neutral",
    focus: ["lead", "perception"],
  },
  {
    fromT: 4.5,
    text: "T-01 detected · sub-acoustic signature",
    sub: "Under foreground rubble · 4.2σ above baseline",
    tone: "alert",
    focus: ["lead", "T-01"],
  },
  {
    fromT: 6.4,
    text: "T-02 detected · thermal signature",
    sub: "Further inside the rubble · 3.1σ",
    tone: "alert",
    focus: ["perception", "T-02"],
  },
  {
    fromT: 7.5,
    text: "Priority calculation · T-01 first",
    sub: "Survival window · T-01 lower than T-02 · dispatch plan locked",
    tone: "command",
    focus: ["relay", "T-01", "T-02"],
  },
  {
    fromT: 10,
    text: "Dispatching ground units",
    sub: "D-01 → T-01 · D-02 → T-02",
    tone: "command",
    focus: ["dog1", "dog2"],
  },
  {
    fromT: 13,
    text: "Ground units approaching targets",
    sub: "D-01 closing on T-01 · D-02 closing on T-02",
    tone: "neutral",
    focus: ["dog1", "dog2"],
  },
  {
    fromT: 15,
    text: "T-01 vital sign confirmed · 87%",
    sub: "D-01 ground sensor positive · LOCK established",
    tone: "success",
    focus: ["dog1", "T-01"],
  },
  {
    fromT: 16.8,
    text: "T-02 vital sign confirmed · 71%",
    sub: "D-02 ground sensor positive · LOCK established",
    tone: "success",
    focus: ["dog2", "T-02"],
  },
  {
    fromT: 18,
    text: "Uplinking dual SitRep to command",
    sub: "A-03 high-bandwidth relay · 2 targets in attendance",
    tone: "command",
    focus: ["relay"],
  },
  {
    fromT: 20,
    text: "Mission state · RESCUE IN PROGRESS",
    sub: "Cluster holding position · awaiting human team",
    tone: "success",
  },
];

/** Returns the active narration beat at the given loop time. */
export function getNarration(loopT: number): NarrationBeat {
  let current = NARRATION_BEATS[0];
  for (const beat of NARRATION_BEATS) {
    if (loopT >= beat.fromT) current = beat;
    else break;
  }
  return current;
}
