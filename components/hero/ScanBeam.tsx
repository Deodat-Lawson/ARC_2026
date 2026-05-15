"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, DoubleSide, Mesh, Vector3 } from "three";
import {
  ASSET_WAYPOINTS,
  applyWaypointLerp,
  currentPhaseIndex,
  getLoopTime,
  SURVIVORS,
} from "./missionTimeline";

/**
 * Overseer drone's ground scan effect — wide searchlight cone projected
 * straight down from A-03 (the relay/third drone) during its IDENTIFY
 * flyover above the buildings. Brightens through the phase, fades by
 * DETERMINE.
 *
 * Components:
 *   • Wide vertical cone from the relay drone to the ground (searchlight)
 *   • Ground pulse ring — locks onto whichever survivor is currently being
 *     identified (cycles between T-01 and T-02)
 */
export function ScanBeam() {
  const cone = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const relayPos = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const t = getLoopTime();
    const phase = currentPhaseIndex(t);

    // Visibility envelope: fully lit through IDENTIFY (phase 1, t=7..14),
    // then a 1s fade at the start of DETERMINE (phase 2).
    let envelope = 0;
    if (phase === 1) {
      envelope = 1;
    } else if (phase === 2) {
      const segT = (t - 14) / 1.0;
      envelope = Math.max(0, 1 - segT);
    }

    applyWaypointLerp(relayPos, ASSET_WAYPOINTS.relay, t);

    // Find which survivor we're currently focused on — whichever was most
    // recently identified
    const focusSurvivor = (() => {
      const recent = SURVIVORS.filter((s) => t >= s.identifyAtT);
      if (recent.length === 0) return SURVIVORS[0];
      return recent[recent.length - 1];
    })();

    if (cone.current) {
      // Cone default orientation: tip at +Y, base at -Y. Tip is anchored at
      // the drone, base spreads across the ground directly underneath.
      cone.current.position.set(
        relayPos.x,
        relayPos.y * 0.5 + focusSurvivor.position[1] * 0.5,
        relayPos.z,
      );
      cone.current.scale.set(1, relayPos.y, 1);
      cone.current.rotation.set(0, 0, 0);
      const pulse = 0.85 + Math.sin(t * 8) * 0.15;
      const m = cone.current.material as { opacity?: number };
      m.opacity = envelope * 0.38 * pulse;
    }

    if (ring.current) {
      ring.current.position.set(focusSurvivor.position[0], 0.04, focusSurvivor.position[2]);
      const radiusPulse = 1 + ((t * 1.4) % 1);
      ring.current.scale.set(radiusPulse, radiusPulse, radiusPulse);
      const m = ring.current.material as { opacity?: number };
      const fade = 1 - ((t * 1.4) % 1);
      m.opacity = envelope * fade * 0.9;
    }
  });

  return (
    <group>
      {/* Huge searchlight cone — base radius 7 (vs 2.6 for the old lead-drone
          scan) so the floodlight reads as a wide swath across the rooftops
          from A-03's overseer altitude (~y=22). */}
      <mesh ref={cone}>
        <coneGeometry args={[7, 1, 32, 1, true]} />
        <meshBasicMaterial
          color="#9bf5ff"
          transparent
          opacity={0}
          side={DoubleSide}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6, 1.9, 48]} />
        <meshBasicMaterial
          color="#9bf5ff"
          transparent
          opacity={0}
          side={DoubleSide}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
