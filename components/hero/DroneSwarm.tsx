"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Vector3 } from "three";
import { Drone } from "./Drone";
import {
  ASSET_WAYPOINTS,
  applyWaypointLerp,
  getLoopTime,
  getSearchOffset,
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

  // Per-drone seed for micro hover-bob phase offset.
  const seed = ASSET_WAYPOINTS[id][0][0];

  // Macro motion — per-phase wandering (sweep / hover / orbit / probe).
  const [sx, sy, sz] = getSearchOffset(id, loopT);
  pos.x += sx;
  pos.y += sy;
  pos.z += sz;

  // Micro hover-bob layered on top for fine-grain "alive" texture.
  pos.y +=
    Math.sin(loopT * 1.6 + seed) * 0.06 +
    Math.sin(loopT * 0.7 + seed * 2) * 0.035;

  g.position.copy(pos);

  // Velocity-aligned yaw — look toward where we'll be in 0.4s.
  applyWaypointLerp(ahead, ASSET_WAYPOINTS[id], (loopT + 0.4) % LOOP_SECONDS);
  ahead.sub(pos);
  if (ahead.x * ahead.x + ahead.z * ahead.z > 0.0001) {
    const targetYaw = Math.atan2(ahead.x, ahead.z);
    const currentYaw = g.rotation.y;
    let delta = targetYaw - currentYaw;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    // Snap on big deltas (loop wrap / FPV reset); ease otherwise.
    const newYaw = Math.abs(delta) > 1.0 ? targetYaw : currentYaw + delta * 0.14;
    g.rotation.set(0, newYaw, 0);
    ASSET_YAWS[id] = newYaw;
  }
}
