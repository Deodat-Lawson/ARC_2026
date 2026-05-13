"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Vector3 } from "three";
import { Drone } from "./Drone";
import {
  DRONE_WAYPOINTS,
  applyWaypointLerp,
  getLoopTime,
} from "./missionTimeline";

/**
 * Three role-specific drones whose positions are driven by the mission
 * timeline waypoints (see missionTimeline.ts):
 *   - A-01 LEAD       — survey, low altitude, descends to scan
 *   - A-02 PERCEPTION — converges on survivor mid-mission
 *   - A-03 RELAY      — high overwatch, comm hub
 *
 * Each drone also gets:
 *   - smoothed velocity-aligned facing (looks where it's flying)
 *   - phase-aware bob (subtle hover when stationary)
 */
export function DroneSwarm() {
  const lead = useRef<Group>(null);
  const perception = useRef<Group>(null);
  const relay = useRef<Group>(null);

  // Reusable scratch vectors
  const tmpA = useRef(new Vector3());
  const tmpB = useRef(new Vector3());

  useFrame(() => {
    const t = getLoopTime();

    updateDrone(lead.current, DRONE_WAYPOINTS.lead, t, tmpA.current, tmpB.current);
    updateDrone(
      perception.current,
      DRONE_WAYPOINTS.perception,
      t,
      tmpA.current,
      tmpB.current,
    );
    updateDrone(
      relay.current,
      DRONE_WAYPOINTS.relay,
      t,
      tmpA.current,
      tmpB.current,
    );
  });

  return (
    <group>
      <group ref={lead}>
        <Drone scale={0.95} rotorSpeed={85} blinkPhase={0} variant="hero" />
      </group>
      <group ref={perception}>
        <Drone scale={0.82} rotorSpeed={78} blinkPhase={1.3} variant="wing" />
      </group>
      <group ref={relay}>
        <Drone scale={0.78} rotorSpeed={70} blinkPhase={2.6} variant="high" />
      </group>
    </group>
  );
}

function updateDrone(
  g: Group | null,
  waypoints: [number, number, number][],
  loopT: number,
  current: Vector3,
  ahead: Vector3,
) {
  if (!g) return;
  applyWaypointLerp(current, waypoints, loopT);
  // Subtle hover bob layered on top of waypoint motion
  current.y += Math.sin(loopT * 1.6 + waypoints[0][0]) * 0.06;
  g.position.copy(current);

  // Heading: look toward where we'll be in 0.4s (velocity-aligned facing)
  applyWaypointLerp(ahead, waypoints, (loopT + 0.4) % 12);
  ahead.sub(current);
  if (ahead.lengthSq() > 0.0001) {
    // Look in the direction of travel; only yaw (Y axis), keep level pitch
    const yaw = Math.atan2(ahead.x, ahead.z);
    g.rotation.set(0, yaw, 0);
  }
}
