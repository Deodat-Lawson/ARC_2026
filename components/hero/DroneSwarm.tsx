"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Vector3 } from "three";
import { Drone } from "./Drone";
import {
  ASSET_WAYPOINTS,
  applyWaypointLerp,
  getLoopTime,
  LOOP_SECONDS,
} from "./missionTimeline";
import { ASSET_POSITIONS, ASSET_YAWS, AssetId, usePovTarget } from "./missionStore";

/**
 * Three role-specific drones whose positions are driven by mission waypoints.
 *
 * Side effects per frame:
 *   - writes world position into ASSET_POSITIONS[id]
 *   - writes yaw into ASSET_YAWS[id]
 * so CameraRig (FPV) and CommBeams can read consistent transforms.
 *
 * The drone whose POV is currently selected is hidden so the FPV camera
 * isn't looking at its own body.
 */
export function DroneSwarm() {
  const lead = useRef<Group>(null);
  const perception = useRef<Group>(null);
  const relay = useRef<Group>(null);
  const tmpAhead = useRef(new Vector3());
  const povTarget = usePovTarget();

  useFrame(() => {
    const t = getLoopTime();
    updateDrone("lead", lead.current, t, tmpAhead.current);
    updateDrone("perception", perception.current, t, tmpAhead.current);
    updateDrone("relay", relay.current, t, tmpAhead.current);
  });

  return (
    <group>
      <group ref={lead} visible={povTarget !== "lead"}>
        <Drone scale={0.95} rotorSpeed={85} blinkPhase={0} variant="hero" />
      </group>
      <group ref={perception} visible={povTarget !== "perception"}>
        <Drone scale={0.82} rotorSpeed={78} blinkPhase={1.3} variant="wing" />
      </group>
      <group ref={relay} visible={povTarget !== "relay"}>
        <Drone scale={0.78} rotorSpeed={70} blinkPhase={2.6} variant="high" />
      </group>
    </group>
  );
}

function updateDrone(id: AssetId, g: Group | null, loopT: number, ahead: Vector3) {
  if (!g) return;
  const pos = ASSET_POSITIONS[id];
  applyWaypointLerp(pos, ASSET_WAYPOINTS[id], loopT);
  // Subtle hover bob
  pos.y += Math.sin(loopT * 1.6 + ASSET_WAYPOINTS[id][0][0]) * 0.06;
  g.position.copy(pos);

  // Velocity-aligned yaw — look toward where we'll be in 0.4s.
  // % LOOP_SECONDS (not a hardcoded number) so it wraps correctly with the
  // current mission length.
  applyWaypointLerp(ahead, ASSET_WAYPOINTS[id], (loopT + 0.4) % LOOP_SECONDS);
  ahead.sub(pos);
  if (ahead.lengthSq() > 0.0001) {
    const yaw = Math.atan2(ahead.x, ahead.z);
    g.rotation.set(0, yaw, 0);
    ASSET_YAWS[id] = yaw;
  }
}
