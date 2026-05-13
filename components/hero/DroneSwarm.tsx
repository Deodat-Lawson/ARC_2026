"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group } from "three";
import { Drone } from "./Drone";

/**
 * V-formation of 4 drones. The whole group drifts slowly toward the camera
 * with a subtle vertical bob; individual drones each have their own bob phase
 * so the formation feels alive instead of locked.
 *
 * Coordinates are tuned for the placeholder Scene. When the baked
 * environment.glb lands, re-check that the formation reads cleanly against the
 * collapsed building silhouettes.
 */

type FormationSlot = {
  offset: [number, number, number];
  scale: number;
  rotorSpeed: number;
  bobPhase: number;
  bobAmp: number;
};

const FORMATION: FormationSlot[] = [
  // Lead (closest to camera, biggest)
  { offset: [0, 0, 0], scale: 1.0, rotorSpeed: 80, bobPhase: 0.0, bobAmp: 0.12 },
  // Left wing
  {
    offset: [-2.2, 0.4, -2.0],
    scale: 0.85,
    rotorSpeed: 72,
    bobPhase: 1.1,
    bobAmp: 0.15,
  },
  // Right wing
  {
    offset: [2.2, 0.4, -2.0],
    scale: 0.85,
    rotorSpeed: 76,
    bobPhase: 2.4,
    bobAmp: 0.14,
  },
  // High background drone
  {
    offset: [-1.0, 2.6, -5.5],
    scale: 0.6,
    rotorSpeed: 90,
    bobPhase: 0.7,
    bobAmp: 0.2,
  },
];

export function DroneSwarm() {
  const group = useRef<Group>(null);
  const slots = useRef<(Group | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Whole swarm drifts forward slowly on a 12s loop
    if (group.current) {
      const loop = (t % 12) / 12;
      group.current.position.x = Math.sin(loop * Math.PI * 2) * 0.4;
      group.current.position.z = -2 + Math.cos(loop * Math.PI * 2) * 0.6;
    }
    // Individual bob
    slots.current.forEach((slot, i) => {
      if (!slot) return;
      const cfg = FORMATION[i];
      slot.position.y = cfg.offset[1] + Math.sin(t * 1.4 + cfg.bobPhase) * cfg.bobAmp;
    });
  });

  return (
    <group ref={group} position={[0, 5, 8]}>
      {FORMATION.map((cfg, i) => (
        <group
          key={i}
          ref={(el) => {
            slots.current[i] = el;
          }}
          position={cfg.offset}
        >
          <Drone
            scale={cfg.scale}
            rotorSpeed={cfg.rotorSpeed}
            blinkPhase={cfg.bobPhase}
            variant={i === 0 ? "hero" : i === 3 ? "high" : "wing"}
          />
        </group>
      ))}
    </group>
  );
}
