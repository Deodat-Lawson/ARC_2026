"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Mesh } from "three";
import {
  getLoopTime,
  LOOP_SECONDS,
  SURVIVORS,
  Survivor,
} from "./missionTimeline";

/**
 * Visualizes the two trapped survivors in the world. Each survivor:
 *
 *   • a small partially-hidden body silhouette (chest + head, dim color)
 *   • a vertical thermal plume (emissive cylinder) that activates once
 *     identified — reads as a heat-signature blip from above
 *   • a ground pulse ring that expands + fades during identification and
 *     stays warm once the assigned dog rescues them
 *
 * State is driven entirely by the mission clock — fades in at each
 * survivor's `identifyAtT`, brightens at `rescuedAtT`.
 */
export function Survivors() {
  return (
    <group>
      {SURVIVORS.map((s) => (
        <SurvivorMarker key={s.id} data={s} />
      ))}
    </group>
  );
}

function SurvivorMarker({ data }: { data: Survivor }) {
  const heatPlume = useRef<Mesh>(null);
  const pulseRing = useRef<Mesh>(null);
  const figure = useRef<Group>(null);

  useFrame(() => {
    const t = getLoopTime();
    // Identification opacity envelope
    let heat = 0; // 0..1
    let confirm = 0; // 0..1
    if (t >= data.identifyAtT) {
      // Smooth fade-in over 0.6s
      heat = Math.min(1, (t - data.identifyAtT) / 0.6);
    }
    if (t >= data.rescuedAtT) {
      confirm = Math.min(1, (t - data.rescuedAtT) / 0.5);
    }
    // Fade out everything during REPORT → NAVIGATE loop wrap
    if (t > LOOP_SECONDS - 0.6) {
      const fade = (LOOP_SECONDS - t) / 0.6;
      heat *= fade;
      confirm *= fade;
    }

    const intensity = heat + confirm * 1.5;

    if (heatPlume.current) {
      const mat = heatPlume.current.material as {
        emissiveIntensity?: number;
        opacity?: number;
      };
      const pulse = 0.7 + Math.sin(t * 6) * 0.3;
      mat.emissiveIntensity = intensity * 3 * pulse;
      mat.opacity = Math.min(1, intensity * 0.55);
    }

    if (pulseRing.current) {
      const cycle = (t * 1.5) % 1;
      const scale = 1 + cycle * 1.6;
      pulseRing.current.scale.set(scale, scale, scale);
      const mat = pulseRing.current.material as { opacity?: number };
      mat.opacity = heat * (1 - cycle) * 0.6 + confirm * 0.5;
    }

    if (figure.current) {
      // The body itself emits a faint warmth once confirmed
      figure.current.traverse((o) => {
        const m = (o as Mesh).material as { emissiveIntensity?: number } | undefined;
        if (m && typeof m.emissiveIntensity === "number") {
          m.emissiveIntensity = confirm * 0.6;
        }
      });
    }
  });

  return (
    <group position={data.position}>
      {/* Small human silhouette (chest + head + arms) — mostly hidden by environment */}
      <group ref={figure} position={[0, 0, 0]}>
        {/* Chest */}
        <mesh position={[0, 0.18, 0]} rotation={[0.3, 0.4, 0]}>
          <boxGeometry args={[0.45, 0.32, 0.22]} />
          <meshStandardMaterial
            color="#2a1f18"
            emissive="#ff5a30"
            emissiveIntensity={0}
            roughness={0.95}
          />
        </mesh>
        {/* Head */}
        <mesh position={[0.06, 0.42, 0.05]}>
          <sphereGeometry args={[0.13, 14, 12]} />
          <meshStandardMaterial
            color="#2a1f18"
            emissive="#ff5a30"
            emissiveIntensity={0}
            roughness={0.95}
          />
        </mesh>
        {/* Arm */}
        <mesh position={[0.22, 0.22, 0.16]} rotation={[0.4, 0.2, -0.9]}>
          <cylinderGeometry args={[0.05, 0.04, 0.32, 8]} />
          <meshStandardMaterial
            color="#2a1f18"
            emissive="#ff5a30"
            emissiveIntensity={0}
            roughness={0.95}
          />
        </mesh>
      </group>

      {/* Vertical thermal plume — emissive cylinder visible from above */}
      <mesh ref={heatPlume} position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.08, 0.18, 2.4, 12, 1, true]} />
        <meshBasicMaterial
          color="#ff7040"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>

      {/* Ground pulse ring */}
      <mesh ref={pulseRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.5, 0.62, 36]} />
        <meshBasicMaterial color="#ffa040" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
