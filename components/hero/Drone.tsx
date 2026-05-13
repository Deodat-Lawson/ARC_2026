"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Mesh } from "three";

type DroneProps = {
  scale?: number;
  rotorSpeed?: number;
  /** Phase offset so blinking lights across the swarm don't sync */
  blinkPhase?: number;
  /** Tone variant: hero drones are slightly brighter */
  variant?: "hero" | "wing" | "high";
};

/**
 * Drone built from primitives — chunky utility quadcopter aesthetic, not
 * consumer-toy. Once Sketchfab GLBs are cleaned, the inner mesh tree gets
 * replaced with `<primitive object={useGLTF(...).scene} />`.
 *
 * Visual budget per drone:
 *   - chassis: 1 hex prism + 1 tapered nose
 *   - sensor pod: 1 sphere + 1 ring
 *   - 4 arms (cylinders) + 4 motor housings + 4 spinning rotors
 *   - 3 nav lights (front white, rear red, belly green pulse)
 *   - 1 emissive status ring
 *
 * ≈ 18 meshes / drone. Across 4 drones that's ~70 meshes; fine for the budget.
 */
export function Drone({
  scale = 1,
  rotorSpeed = 60,
  blinkPhase = 0,
  variant = "wing",
}: DroneProps) {
  const root = useRef<Group>(null);
  const rotors = useRef<Group>(null);
  const beacon = useRef<Mesh>(null);
  const statusRing = useRef<Mesh>(null);

  useFrame((state, dt) => {
    if (rotors.current) rotors.current.rotation.y += rotorSpeed * dt;

    const t = state.clock.elapsedTime + blinkPhase;

    if (beacon.current) {
      const pulse = (Math.sin(t * 4.5) + 1) * 0.5;
      const mat = beacon.current.material as { emissiveIntensity?: number };
      if (typeof mat.emissiveIntensity === "number") {
        mat.emissiveIntensity = 0.5 + pulse * 6;
      }
    }
    if (statusRing.current) {
      const slow = (Math.sin(t * 1.2) + 1) * 0.5;
      const mat = statusRing.current.material as { emissiveIntensity?: number };
      if (typeof mat.emissiveIntensity === "number") {
        mat.emissiveIntensity = 0.4 + slow * 1.4;
      }
    }
  });

  const chassisColor = variant === "hero" ? "#1f2126" : "#16181c";
  const trimColor = variant === "hero" ? "#3a3f48" : "#2a2e35";

  // X-configuration arm positions
  const arms: [number, number, number][] = [
    [0.62, 0.04, 0.58],
    [-0.62, 0.04, 0.58],
    [0.62, 0.04, -0.58],
    [-0.62, 0.04, -0.58],
  ];

  return (
    <group ref={root} scale={scale}>
      {/* Chassis main body — hex prism */}
      <mesh rotation={[0, Math.PI / 6, 0]}>
        <cylinderGeometry args={[0.42, 0.46, 0.22, 6]} />
        <meshStandardMaterial color={chassisColor} metalness={0.55} roughness={0.45} />
      </mesh>

      {/* Top deck — flat hex cap for the antenna stalks */}
      <mesh position={[0, 0.13, 0]} rotation={[0, Math.PI / 6, 0]}>
        <cylinderGeometry args={[0.36, 0.4, 0.06, 6]} />
        <meshStandardMaterial color={trimColor} metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Antenna stalks */}
      <mesh position={[0.18, 0.28, -0.05]}>
        <cylinderGeometry args={[0.012, 0.012, 0.32, 6]} />
        <meshStandardMaterial color="#0a0c0f" roughness={0.6} />
      </mesh>
      <mesh position={[-0.16, 0.24, 0.06]}>
        <cylinderGeometry args={[0.012, 0.012, 0.24, 6]} />
        <meshStandardMaterial color="#0a0c0f" roughness={0.6} />
      </mesh>

      {/* Nose / sensor cowl */}
      <mesh position={[0, -0.03, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.24, 0.3, 12]} />
        <meshStandardMaterial color={trimColor} metalness={0.5} roughness={0.5} />
      </mesh>

      {/* Camera ball under nose */}
      <mesh position={[0, -0.14, 0.5]}>
        <sphereGeometry args={[0.11, 16, 16]} />
        <meshStandardMaterial color="#06080a" metalness={0.85} roughness={0.18} />
      </mesh>

      {/* Camera lens highlight */}
      <mesh position={[0, -0.14, 0.55]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial
          color="#2a2f38"
          metalness={0.9}
          roughness={0.05}
          emissive="#1a3a32"
          emissiveIntensity={0.4}
        />
      </mesh>

      {/* Status ring — emissive band around chassis */}
      <mesh ref={statusRing} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <torusGeometry args={[0.44, 0.012, 4, 24]} />
        <meshStandardMaterial
          color="#5dffb4"
          emissive="#5dffb4"
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>

      {/* Arms */}
      {arms.map((p, i) => {
        const angle = Math.atan2(p[2], p[0]);
        return (
          <group key={`arm${i}`} position={[p[0] / 2, p[1], p[2] / 2]} rotation={[0, -angle, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.55, 8]} />
              <meshStandardMaterial color={trimColor} metalness={0.5} roughness={0.55} />
            </mesh>
          </group>
        );
      })}

      {/* Motor housings */}
      {arms.map((p, i) => (
        <mesh key={`motor${i}`} position={[p[0], p[1] + 0.05, p[2]]}>
          <cylinderGeometry args={[0.1, 0.1, 0.1, 12]} />
          <meshStandardMaterial color="#0a0c10" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}

      {/* Spinning rotors (disc-like blur) */}
      <group ref={rotors}>
        {arms.map((p, i) => (
          <group key={`rot${i}`} position={[p[0], p[1] + 0.15, p[2]]}>
            <mesh>
              <cylinderGeometry args={[0.42, 0.42, 0.012, 24]} />
              <meshStandardMaterial
                color="#0a0a0a"
                transparent
                opacity={0.28}
                roughness={0.9}
                depthWrite={false}
              />
            </mesh>
            {/* Two blade ghosts to give visual texture */}
            <mesh rotation={[0, 0, 0]}>
              <boxGeometry args={[0.82, 0.012, 0.05]} />
              <meshStandardMaterial color="#181a1e" transparent opacity={0.5} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <boxGeometry args={[0.82, 0.012, 0.05]} />
              <meshStandardMaterial color="#181a1e" transparent opacity={0.5} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Nav lights */}
      <mesh ref={beacon} position={[0, 0, 0.58]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial
          color="#5dffb4"
          emissive="#5dffb4"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, -0.36]}>
        <sphereGeometry args={[0.04, 12, 12]} />
        <meshStandardMaterial
          color="#ff5d6c"
          emissive="#ff5d6c"
          emissiveIntensity={2.2}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, -0.13, 0]}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
