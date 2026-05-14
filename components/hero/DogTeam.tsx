"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Vector3 } from "three";
import { RobotDog } from "./RobotDog";
import {
  ASSET_WAYPOINTS,
  applyWaypointLerp,
  getLoopTime,
  getSearchOffset,
  LOOP_SECONDS,
} from "./missionTimeline";
import { ASSET_POSITIONS, ASSET_YAWS, AssetId, usePovTarget } from "./missionStore";

/**
 * Two ground robot dogs that follow waypoint paths on the ground.
 *
 *   - D-01 SCOUT     — dispatched to survivor on DETECT, arrives by CONFIRM
 *   - D-02 SUPPORT   — mobile charging station, holds rear perimeter
 *
 * Side effects: writes positions/yaws into ASSET_POSITIONS / ASSET_YAWS so
 * the FPV camera and comm beams pick up the correct transforms.
 */
export function DogTeam() {
  const dog1 = useRef<Group>(null);
  const dog2 = useRef<Group>(null);
  const tmpAhead = useRef(new Vector3());
  const povTarget = usePovTarget();

  useFrame(() => {
    const t = getLoopTime();
    updateDog("dog1", dog1.current, t, tmpAhead.current);
    updateDog("dog2", dog2.current, t, tmpAhead.current);
  });

  return (
    <group>
      <group ref={dog1} visible={povTarget !== "dog1"}>
        <RobotDog gaitSpeed={5.5} gaitOffset={0} blinkPhase={0} />
      </group>
      <group ref={dog2} visible={povTarget !== "dog2"}>
        <RobotDog gaitSpeed={4.8} gaitOffset={1.7} blinkPhase={1.2} />
      </group>
    </group>
  );
}

function updateDog(id: AssetId, g: Group | null, loopT: number, ahead: Vector3) {
  if (!g) return;
  const pos = ASSET_POSITIONS[id];
  applyWaypointLerp(pos, ASSET_WAYPOINTS[id], loopT);

  // Per-phase search wandering — small drift during travel, real probing
  // around the survivor during RESCUE.
  const [sx, , sz] = getSearchOffset(id, loopT);
  pos.x += sx;
  pos.z += sz;
  g.position.copy(pos);

  // Velocity-aligned yaw with smoothing; snap on big deltas (loop wrap).
  applyWaypointLerp(ahead, ASSET_WAYPOINTS[id], (loopT + 0.6) % LOOP_SECONDS);
  ahead.sub(pos);
  if (ahead.x * ahead.x + ahead.z * ahead.z > 0.0001) {
    const targetYaw = Math.atan2(ahead.x, ahead.z);
    const currentYaw = g.rotation.y;
    let delta = targetYaw - currentYaw;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const newYaw = Math.abs(delta) > 1.0 ? targetYaw : currentYaw + delta * 0.11;
    g.rotation.set(0, newYaw, 0);
    ASSET_YAWS[id] = newYaw;
  }
}
