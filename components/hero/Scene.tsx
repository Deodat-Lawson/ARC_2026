"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import { Color, MathUtils } from "three";

/**
 * Static environment. In production this loads /public/models/environment.glb
 * — a baked Blender scene exported with Draco + KTX2 compression.
 *
 * While that asset is being built in Blender, this component falls back to a
 * procedurally-blocked-out ruined cityscape. The goal of the placeholder is
 * to read at a glance as "earthquake aftermath" without real textures:
 *
 *   - varied building silhouettes (some tilted, some collapsed)
 *   - exposed structural members (rebar cylinders)
 *   - scattered rubble across the foreground
 *   - dark ground tinted in patches
 *
 * Swap the flag once environment.glb is in place.
 */
const USE_PLACEHOLDER = true;

export function Scene() {
  if (USE_PLACEHOLDER) return <PlaceholderEnvironment />;
  return <BakedEnvironment />;
}

function BakedEnvironment() {
  const { scene } = useGLTF("/models/environment.glb");
  return <primitive object={scene} />;
}
if (!USE_PLACEHOLDER) {
  useGLTF.preload("/models/environment.glb");
}

// ---------- Placeholder ----------

type Building = {
  pos: [number, number, number];
  size: [number, number, number];
  tilt: [number, number, number];
  color: string;
  /** 0 = intact, 1 = mostly rubble */
  damage: number;
};

const seeded = (i: number) => {
  // deterministic small noise so rebuilds don't reshuffle
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

function PlaceholderEnvironment() {
  const buildings = useMemo<Building[]>(
    () => [
      // Foreground left — tall, top sheared off
      { pos: [-9, 6, -2], size: [9, 12, 8], tilt: [0.04, -0.1, 0.05], color: "#2a2724", damage: 0.4 },
      // Foreground right — squat, leaning
      { pos: [7, 3.5, -4], size: [8, 9, 8], tilt: [0.02, 0.18, -0.12], color: "#23211e", damage: 0.6 },
      // Mid hero — partially collapsed mass
      { pos: [-2, 2, -22], size: [16, 16, 12], tilt: [-0.05, 0.04, 0.02], color: "#24211d", damage: 0.7 },
      // Right mid — taller tower
      { pos: [15, 6, -28], size: [10, 18, 10], tilt: [0.02, -0.06, -0.03], color: "#1e1c19", damage: 0.3 },
      // Distant left
      { pos: [-20, 5, -36], size: [14, 14, 14], tilt: [0, 0.1, 0], color: "#1c1a17", damage: 0.5 },
      // Far background
      { pos: [24, 4, -54], size: [22, 16, 16], tilt: [0, -0.05, 0.02], color: "#17150f", damage: 0.4 },
      { pos: [-30, 7, -60], size: [20, 18, 18], tilt: [0, 0.04, 0], color: "#18161180", damage: 0.5 },
    ],
    [],
  );

  // Rubble — instanced via individual meshes with slight variation
  const rubble = useMemo(() => {
    return Array.from({ length: 80 }).map((_, i) => {
      const a = (i / 80) * Math.PI * 2 + seeded(i) * 0.5;
      const r = 5 + seeded(i + 1) * 22;
      const z = -6 - seeded(i + 2) * 32;
      return {
        pos: [
          Math.cos(a) * r * (0.5 + seeded(i + 3) * 0.5),
          0.1 + seeded(i + 4) * 0.45,
          z,
        ] as [number, number, number],
        rot: [seeded(i + 5) * 1.2, seeded(i + 6) * Math.PI * 2, seeded(i + 7) * 1.2] as [
          number,
          number,
          number,
        ],
        scale: 0.25 + seeded(i + 8) * 0.7,
        shade: 0.18 + seeded(i + 9) * 0.1,
      };
    });
  }, []);

  // Rebar — thin tilted cylinders rising out of damaged building tops
  const rebar = useMemo(() => {
    const out: {
      pos: [number, number, number];
      tilt: [number, number, number];
      h: number;
    }[] = [];
    buildings.forEach((b, bi) => {
      if (b.damage < 0.3) return;
      const count = Math.round(2 + b.damage * 5);
      for (let i = 0; i < count; i++) {
        const dx = (seeded(bi * 13 + i) - 0.5) * b.size[0] * 0.6;
        const dz = (seeded(bi * 17 + i + 5) - 0.5) * b.size[2] * 0.6;
        out.push({
          pos: [b.pos[0] + dx, b.pos[1] + b.size[1] / 2 + 0.4, b.pos[2] + dz],
          tilt: [
            (seeded(bi * 19 + i) - 0.5) * 0.6,
            seeded(bi * 23 + i) * Math.PI,
            (seeded(bi * 29 + i) - 0.5) * 0.6,
          ],
          h: 0.6 + seeded(bi * 31 + i) * 1.6,
        });
      }
    });
    return out;
  }, [buildings]);

  // Ground patches — darker irregular zones
  const groundPatches = useMemo(() => {
    return Array.from({ length: 10 }).map((_, i) => ({
      pos: [
        (seeded(i) - 0.5) * 60,
        0.005,
        -10 - seeded(i + 20) * 40,
      ] as [number, number, number],
      scale: 4 + seeded(i + 40) * 10,
      shade: 0.07 + seeded(i + 60) * 0.08,
    }));
  }, []);

  return (
    <group>
      {/* Base ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -20]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial color="#0f0d0a" roughness={1} />
      </mesh>

      {/* Darker ground patches (impact / scorch / debris fields) */}
      {groundPatches.map((g, i) => (
        <mesh
          key={`gp${i}`}
          rotation={[-Math.PI / 2, 0, seeded(i) * Math.PI]}
          position={g.pos}
        >
          <circleGeometry args={[g.scale, 6]} />
          <meshStandardMaterial
            color={new Color(g.shade, g.shade * 0.85, g.shade * 0.7)}
            roughness={1}
          />
        </mesh>
      ))}

      {/* Buildings */}
      {buildings.map((b, i) => (
        <CollapsedBuilding key={`b${i}`} {...b} seed={i} />
      ))}

      {/* Rebar */}
      {rebar.map((r, i) => (
        <mesh
          key={`r${i}`}
          position={r.pos}
          rotation={r.tilt}
        >
          <cylinderGeometry args={[0.04, 0.04, r.h, 6]} />
          <meshStandardMaterial color="#3a2e22" roughness={0.7} metalness={0.5} />
        </mesh>
      ))}

      {/* Rubble */}
      {rubble.map((r, i) => (
        <mesh key={`u${i}`} position={r.pos} rotation={r.rot} scale={r.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color={new Color(r.shade, r.shade * 0.95, r.shade * 0.85)}
            roughness={1}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A collapsed building. Bottom is a tilted main mass, then a smaller offset
 * "broken top" stub. When damage is high, an extra debris pile sits at the
 * base so it reads as partially fallen.
 */
function CollapsedBuilding({
  pos,
  size,
  tilt,
  color,
  damage,
  seed,
}: Building & { seed: number }) {
  const [x, y, z] = pos;
  const [w, h, d] = size;

  const broken = damage > 0.35;
  const heavyDamage = damage > 0.6;

  // The remaining height after collapse
  const remainingH = MathUtils.lerp(h, h * 0.5, damage);
  const ground = MathUtils.lerp(y, y - h * 0.25, damage);

  // Broken top stub: smaller box offset to one side
  const stubW = w * (0.55 + seeded(seed) * 0.2);
  const stubD = d * (0.5 + seeded(seed + 7) * 0.25);
  const stubH = remainingH * (0.35 + seeded(seed + 11) * 0.25);
  const stubX = (seeded(seed + 3) - 0.5) * (w - stubW);
  const stubZ = (seeded(seed + 5) - 0.5) * (d - stubD);

  return (
    <group position={[x, ground, z]} rotation={tilt}>
      {/* Main mass */}
      <mesh>
        <boxGeometry args={[w, remainingH, d]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>

      {/* Window-suggestion stripes — emissive trace of dim interior light */}
      {!heavyDamage && (
        <mesh position={[0, 0, d / 2 + 0.01]}>
          <planeGeometry args={[w * 0.7, remainingH * 0.6]} />
          <meshBasicMaterial
            color="#1c1a16"
            transparent
            opacity={0.6}
          />
        </mesh>
      )}

      {/* Broken top */}
      {broken && (
        <group position={[stubX, remainingH / 2 + stubH / 2, stubZ]}>
          <mesh rotation={[seeded(seed + 9) * 0.2, 0, seeded(seed + 13) * 0.2]}>
            <boxGeometry args={[stubW, stubH, stubD]} />
            <meshStandardMaterial color={color} roughness={1} />
          </mesh>
        </group>
      )}

      {/* Debris pile at base */}
      {heavyDamage && (
        <mesh position={[(seeded(seed + 17) - 0.5) * w * 0.4, -remainingH / 2 + 0.4, d / 2 + 0.6]}>
          <coneGeometry args={[Math.min(w, d) * 0.35, 1.5, 5, 1]} />
          <meshStandardMaterial color="#1a1714" roughness={1} />
        </mesh>
      )}
    </group>
  );
}
