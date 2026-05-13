"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  DoubleSide,
  Mesh,
  Vector3,
} from "three";
import {
  applyWaypointLerp,
  currentPhaseIndex,
  DRONE_WAYPOINTS,
  getLoopTime,
  SURVIVOR_POS,
} from "./missionTimeline";

/**
 * Lead drone's ground scan effect.
 *
 *   • Cone of emissive light from the lead drone toward the ground
 *   • Ring on the ground showing scan radius — pulses outward during SCAN
 *   • Both fade in during SCAN, brighten during DETECT (when the beam
 *     'finds' the survivor), then fade out by CONFIRM
 */
export function ScanBeam() {
  const cone = useRef<Mesh>(null);
  const coneMatRef = useRef<{ opacity?: number }>({});
  const ring = useRef<Mesh>(null);
  const ringMatRef = useRef<{ opacity?: number }>({});

  const lead = useMemo(() => new Vector3(), []);

  useFrame((state) => {
    const t = getLoopTime();
    const phase = currentPhaseIndex(t);

    // Visibility envelope across phases:
    //   SCAN (2): fade in to 0.6
    //   DETECT (3): peak to 1.0
    //   CONFIRM (4): hold 0.8
    //   else: 0
    let envelope = 0;
    if (phase === 2) {
      // 0 → 0.6 over the 2s scan window
      const segT = (t - 4) / 2;
      envelope = Math.min(1, segT) * 0.6;
    } else if (phase === 3) {
      envelope = 0.6 + ((t - 6) / 2) * 0.4;
    } else if (phase === 4) {
      envelope = 1.0 - ((t - 8) / 2) * 0.2;
    } else if (phase === 5) {
      envelope = Math.max(0, 0.8 - ((t - 10) / 1) * 0.8);
    }

    applyWaypointLerp(lead, DRONE_WAYPOINTS.lead, t);

    // Position cone at the lead drone, pointing down (negative Y).
    if (cone.current) {
      cone.current.position.set(lead.x, lead.y * 0.5 + SURVIVOR_POS[1] * 0.5, lead.z);
      cone.current.scale.set(1, lead.y, 1);
      // Cone is created pointing along +Y; rotate so it points down toward ground
      cone.current.rotation.set(Math.PI, 0, 0);
      // Pulse the cone with a fast modulation during active scan
      const pulse = 0.85 + Math.sin(t * 8) * 0.15;
      const m = cone.current.material as { opacity?: number };
      m.opacity = envelope * 0.35 * pulse;
      coneMatRef.current = m;
    }

    if (ring.current) {
      // Ring sits on the ground under the lead drone (or on the survivor
      // during detect/confirm so the camera sees the lock)
      const targetX = phase >= 3 ? SURVIVOR_POS[0] : lead.x;
      const targetZ = phase >= 3 ? SURVIVOR_POS[2] : lead.z;
      ring.current.position.set(targetX, 0.05, targetZ);

      // Pulsing radius
      const radiusPulse = 1 + ((t * 1.4) % 1);
      ring.current.scale.set(radiusPulse, radiusPulse, radiusPulse);

      const m = ring.current.material as { opacity?: number };
      const fade = 1 - ((t * 1.4) % 1);
      m.opacity = envelope * fade * 0.9;
      ringMatRef.current = m;
    }
  });

  return (
    <group>
      {/* Vertical scan cone */}
      <mesh ref={cone} visible>
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

      {/* Ground scan ring */}
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
