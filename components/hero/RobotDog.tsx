"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Mesh } from "three";

type Props = {
  /** Walking gait phase in seconds (drives leg cycle) */
  gaitSpeed?: number;
  /** Phase offset so two dogs don't move in lock-step */
  gaitOffset?: number;
  /** Status light blink phase offset */
  blinkPhase?: number;
};

/**
 * Quadruped ground robot — Spot/Anymal-style. Built from primitives:
 *   - chunky body box
 *   - 4 articulated legs (upper segment + lower segment + foot)
 *   - sensor head with camera + lidar dome
 *   - status lights
 *
 * Animation: 2-2 trot gait (diagonal pairs of legs move together). Body
 * dips slightly with each step. Head can pan independently.
 */
export function RobotDog({
  gaitSpeed = 6.0,
  gaitOffset = 0,
  blinkPhase = 0,
}: Props) {
  const body = useRef<Group>(null);
  const legFL = useRef<Group>(null);
  const legFR = useRef<Group>(null);
  const legBL = useRef<Group>(null);
  const legBR = useRef<Group>(null);
  const beacon = useRef<Mesh>(null);

  useFrame((s) => {
    const t = s.clock.elapsedTime * gaitSpeed + gaitOffset;
    // Two diagonal pairs (FL+BR, FR+BL) move together — classic trot
    const phaseA = Math.sin(t);
    const phaseB = Math.sin(t + Math.PI);

    if (legFL.current) legFL.current.rotation.x = phaseA * 0.5;
    if (legBR.current) legBR.current.rotation.x = phaseA * 0.5;
    if (legFR.current) legFR.current.rotation.x = phaseB * 0.5;
    if (legBL.current) legBL.current.rotation.x = phaseB * 0.5;

    // Body dip with gait
    if (body.current) {
      body.current.position.y = 0.42 + Math.abs(phaseA) * 0.03;
    }

    // Status beacon pulse
    if (beacon.current) {
      const pulse = (Math.sin(s.clock.elapsedTime * 3 + blinkPhase) + 1) * 0.5;
      const mat = beacon.current.material as { emissiveIntensity?: number };
      if (typeof mat.emissiveIntensity === "number") {
        mat.emissiveIntensity = 0.5 + pulse * 3;
      }
    }
  });

  const chassisColor = "#16181c";
  const trimColor = "#2a2e35";

  return (
    <group ref={body}>
      {/* Body */}
      <mesh>
        <boxGeometry args={[0.9, 0.3, 0.4]} />
        <meshStandardMaterial color={chassisColor} metalness={0.5} roughness={0.5} />
      </mesh>

      {/* Body top deck (sensor array) */}
      <mesh position={[0, 0.18, -0.05]}>
        <boxGeometry args={[0.7, 0.05, 0.32]} />
        <meshStandardMaterial color={trimColor} metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Head/neck (forward) */}
      <group position={[0.5, 0.05, 0]}>
        <mesh>
          <boxGeometry args={[0.22, 0.22, 0.28]} />
          <meshStandardMaterial color={chassisColor} metalness={0.55} roughness={0.45} />
        </mesh>
        {/* Lidar dome on top */}
        <mesh position={[0, 0.16, 0]}>
          <sphereGeometry args={[0.08, 14, 12]} />
          <meshStandardMaterial color="#06080a" metalness={0.85} roughness={0.18} />
        </mesh>
        {/* Forward camera lens */}
        <mesh position={[0.13, -0.02, 0]} rotation={[0, Math.PI / 2, 0]}>
          <cylinderGeometry args={[0.045, 0.055, 0.04, 16]} />
          <meshStandardMaterial
            color="#1a3a32"
            emissive="#1a3a32"
            emissiveIntensity={0.6}
            metalness={0.6}
            roughness={0.2}
          />
        </mesh>
      </group>

      {/* Status beacon on top — visible from distance */}
      <mesh ref={beacon} position={[-0.3, 0.22, 0]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial
          color="#5dffb4"
          emissive="#5dffb4"
          emissiveIntensity={2.5}
          toneMapped={false}
        />
      </mesh>

      {/* Tail antenna */}
      <mesh position={[-0.46, 0.18, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 0.22, 6]} />
        <meshStandardMaterial color="#0a0c0f" roughness={0.6} />
      </mesh>

      {/* Legs — 4 articulated quadruped legs */}
      <Leg ref={legFL} hipPos={[0.28, -0.12, 0.18]} />
      <Leg ref={legFR} hipPos={[0.28, -0.12, -0.18]} />
      <Leg ref={legBL} hipPos={[-0.28, -0.12, 0.18]} />
      <Leg ref={legBR} hipPos={[-0.28, -0.12, -0.18]} />
    </group>
  );
}

/**
 * A single quadruped leg: a hip group (rotated by parent for gait swing) with
 * upper + lower segments and a foot.
 */
const Leg = function Leg({
  hipPos,
  ref,
}: {
  hipPos: [number, number, number];
  ref?: React.Ref<Group>;
}) {
  return (
    <group ref={ref} position={hipPos}>
      {/* Hip joint */}
      <mesh>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#0a0c10" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Upper segment */}
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.035, 0.03, 0.22, 8]} />
        <meshStandardMaterial color="#1a1c20" metalness={0.55} roughness={0.45} />
      </mesh>
      {/* Knee */}
      <mesh position={[0, -0.24, 0]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#0a0c10" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Lower segment */}
      <mesh position={[0, -0.34, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.18, 8]} />
        <meshStandardMaterial color="#1a1c20" metalness={0.55} roughness={0.45} />
      </mesh>
      {/* Foot */}
      <mesh position={[0, -0.44, 0]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#06070a" metalness={0.7} roughness={0.6} />
      </mesh>
    </group>
  );
};
