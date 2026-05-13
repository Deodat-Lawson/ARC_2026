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
 * Lead drone's ground scan effect. Active during IDENTIFY phase, brightens
 * as targets are detected, fades by DETERMINE.
 *
 * Components:
 *   • Vertical cone from the lead drone toward the ground
 *   • Ground pulse ring — locks onto whichever survivor is currently being
 *     identified (cycles between T-01 and T-02)
 */
export function ScanBeam() {
  const cone = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const leadPos = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const t = getLoopTime();
    const phase = currentPhaseIndex(t);

    // Visibility envelope tied to the 22s loop:
    //   IDENTIFY (phase 1, t=3..7): build up to full intensity
    //   DETERMINE (phase 2, t=7..10): fade out over first second
    let envelope = 0;
    if (phase === 1) {
      const segT = (t - 3) / 4.0; // 0 → 1 across IDENTIFY (4s)
      envelope = Math.min(1, segT);
    } else if (phase === 2) {
      const segT = (t - 7) / 1.0; // fade out in first second of DETERMINE
      envelope = Math.max(0, 1 - segT);
    }

    applyWaypointLerp(leadPos, ASSET_WAYPOINTS.lead, t);

    // Find which survivor we're currently focused on — whichever was most
    // recently identified
    const focusSurvivor = (() => {
      const recent = SURVIVORS.filter((s) => t >= s.identifyAtT);
      if (recent.length === 0) return SURVIVORS[0];
      return recent[recent.length - 1];
    })();

    if (cone.current) {
      // Cone default orientation: tip at +Y, base at -Y. We want tip AT the
      // drone (top) and base on the ground — that's exactly the default, no
      // rotation needed. Earlier code flipped this with Math.PI which made it
      // a "reverse cone" (base at drone, tip on ground).
      cone.current.position.set(
        leadPos.x,
        leadPos.y * 0.5 + focusSurvivor.position[1] * 0.5,
        leadPos.z,
      );
      cone.current.scale.set(1, leadPos.y, 1);
      cone.current.rotation.set(0, 0, 0);
      const pulse = 0.85 + Math.sin(t * 8) * 0.15;
      const m = cone.current.material as { opacity?: number };
      m.opacity = envelope * 0.32 * pulse;
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
      <mesh ref={cone}>
        <coneGeometry args={[2.6, 1, 24, 1, true]} />
        <meshBasicMaterial
          color="#5dffb4"
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
          color="#5dffb4"
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
