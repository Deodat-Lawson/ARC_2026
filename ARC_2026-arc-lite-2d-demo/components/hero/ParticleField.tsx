"use client";

import { Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Mesh } from "three";

/**
 * Atmospheric layer. Four ingredients:
 *
 *   1. Sparkles (drei) — fine ambient dust motes, GPU instanced (~1 draw call)
 *   2. Low haze plane — wide warm sheet at chest height for ground fog
 *   3. High haze plane — thinner band high up, scrolls horizontally
 *   4. Faux god-ray cones — long tapered planes from off-screen sun direction,
 *      additive blend, slow rotation. These read as light shafts cutting
 *      through windows / between buildings. Cheaper than real volumetric
 *      light and works with our current post-FX-disabled state.
 */
export function ParticleField() {
  const lowHaze = useRef<Mesh>(null);
  const highHaze = useRef<Mesh>(null);
  const rays = useRef<Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (lowHaze.current) lowHaze.current.position.x = Math.sin(t * 0.05) * 2;
    if (highHaze.current) highHaze.current.position.x = Math.cos(t * 0.04) * 3;
    if (rays.current) rays.current.rotation.z = Math.sin(t * 0.06) * 0.05;
  });

  return (
    <group>
      <Sparkles
        count={400}
        scale={[44, 14, 36]}
        position={[0, 6, -10]}
        size={2.4}
        speed={0.18}
        opacity={0.55}
        color="#e2c9a3"
      />

      {/* Low warm haze sheet — ground fog */}
      <mesh ref={lowHaze} position={[0, 1.6, -8]}>
        <planeGeometry args={[80, 6]} />
        <meshBasicMaterial
          color="#3a261a"
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>

      {/* High haze sheet behind buildings */}
      <mesh ref={highHaze} position={[0, 10, -28]}>
        <planeGeometry args={[100, 12]} />
        <meshBasicMaterial
          color="#5a4634"
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>

      {/* God-ray suggestion cones — three tapered shafts from the sun direction */}
      <group ref={rays} position={[6, 18, -22]} rotation={[0.2, 0.1, -0.25]}>
        <GodRayShaft
          length={42}
          width={5}
          opacity={0.16}
          offset={[-4, -2, 0]}
        />
        <GodRayShaft length={38} width={3.5} opacity={0.12} offset={[2, -3, 1]} />
        <GodRayShaft length={36} width={4.2} opacity={0.1} offset={[6, -1, -1]} />
      </group>
    </group>
  );
}

/**
 * A single light-shaft plane. Long thin quad pointing roughly down/forward
 * from the sun direction, additive blend so it brightens what's behind it.
 */
function GodRayShaft({
  length,
  width,
  opacity,
  offset,
}: {
  length: number;
  width: number;
  opacity: number;
  offset: [number, number, number];
}) {
  return (
    <mesh position={offset} rotation={[Math.PI / 2.4, 0, 0]}>
      <planeGeometry args={[width, length]} />
      <meshBasicMaterial
        color="#ffd9a0"
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}
