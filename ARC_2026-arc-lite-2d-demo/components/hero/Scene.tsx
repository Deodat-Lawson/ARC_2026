"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Group, Mesh, MeshStandardMaterial } from "three";

/**
 * High-quality disaster street set for the POV demo.
 *
 * The recovered KBS105 pack is a large authoring payload (632 MB FBX plus
 * source textures). Until selected pieces are exported into optimized GLBs,
 * this scene keeps the demo production-looking with authored procedural
 * geometry, dense foreground rubble, smoke, fire, signage, and a clear central
 * alley for the existing drone/dog waypoints.
 */
export function Scene() {
  const materials = useSceneMaterials();

  return (
    <group>
      <Ground materials={materials} />
      <SkylineRing />
      <RuinedBuildings materials={materials} />
      <StreetSetDressing materials={materials} />
      <RubbleField material={materials.concrete} />
      <SmokeColumns />
      <BurningGlow />
    </group>
  );
}

type Materials = {
  concrete: MeshStandardMaterial;
  concreteDark: MeshStandardMaterial;
  brick: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  asphalt: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  warning: MeshStandardMaterial;
};

function useSceneMaterials(): Materials {
  return useMemo(
    () => ({
      concrete: new MeshStandardMaterial({
        color: "#746d63",
        roughness: 0.96,
        metalness: 0.02,
      }),
      concreteDark: new MeshStandardMaterial({
        color: "#3c3934",
        roughness: 1,
        metalness: 0,
      }),
      brick: new MeshStandardMaterial({
        color: "#8a6554",
        roughness: 0.92,
        metalness: 0.01,
      }),
      metal: new MeshStandardMaterial({
        color: "#5b554d",
        roughness: 0.68,
        metalness: 0.55,
      }),
      asphalt: new MeshStandardMaterial({
        color: "#171512",
        roughness: 1,
        metalness: 0,
      }),
      glass: new MeshStandardMaterial({
        color: "#1b2f36",
        roughness: 0.28,
        metalness: 0.08,
        emissive: "#071115",
        emissiveIntensity: 0.25,
      }),
      warning: new MeshStandardMaterial({
        color: "#d6a23a",
        roughness: 0.72,
        metalness: 0.25,
        emissive: "#3a2108",
        emissiveIntensity: 0.18,
      }),
    }),
    [],
  );
}

function Ground({ materials }: { materials: Materials }) {
  const patches = useMemo(() => {
    const out: { pos: [number, number, number]; r: number; rot: number; color: string }[] = [];
    for (let i = 0; i < 28; i++) {
      const s = seed(i);
      out.push({
        pos: [(s - 0.5) * 76, 0.006, 12 - seed(i + 9) * 82],
        r: 2 + seed(i + 18) * 9,
        rot: seed(i + 27) * Math.PI,
        color: seed(i + 36) > 0.5 ? "#221d18" : "#0f1110",
      });
    }
    return out;
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -32]}>
        <planeGeometry args={[420, 420]} />
        <primitive object={materials.asphalt} attach="material" />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, -15]}>
        <planeGeometry args={[7, 86]} />
        <meshStandardMaterial color="#23211d" roughness={1} />
      </mesh>

      {[-2.75, 2.75].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.014, -15]}>
          <planeGeometry args={[0.06, 82]} />
          <meshBasicMaterial color="#746a58" transparent opacity={0.35} />
        </mesh>
      ))}

      {patches.map((p, i) => (
        <mesh key={`patch${i}`} rotation={[-Math.PI / 2, 0, p.rot]} position={p.pos}>
          <circleGeometry args={[p.r, 10]} />
          <meshStandardMaterial color={p.color} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function RuinedBuildings({ materials }: { materials: Materials }) {
  const buildings: BuildingSpec[] = [
    { pos: [-14, 5.5, -16], size: [10, 11, 9], rot: 0.18, mat: materials.brick, damage: "left" },
    { pos: [13, 6, -20], size: [10, 12, 10], rot: -0.44, mat: materials.concrete, damage: "right" },
    { pos: [-18, 7, -36], size: [12, 14, 10], rot: -0.28, mat: materials.concrete, damage: "top" },
    { pos: [20, 7.5, -40], size: [12, 15, 9], rot: 0.34, mat: materials.brick, damage: "left" },
    { pos: [-33, 10, -68], size: [16, 20, 11], rot: 0.18, mat: materials.concreteDark, damage: "top" },
    { pos: [34, 11, -72], size: [18, 22, 12], rot: -0.22, mat: materials.concreteDark, damage: "right" },
  ];

  return (
    <group>
      {buildings.map((b, i) => (
        <RuinedBuilding key={`building${i}`} spec={b} materials={materials} />
      ))}
    </group>
  );
}

type BuildingSpec = {
  pos: [number, number, number];
  size: [number, number, number];
  rot: number;
  mat: MeshStandardMaterial;
  damage: "left" | "right" | "top";
};

function RuinedBuilding({
  spec,
  materials,
}: {
  spec: BuildingSpec;
  materials: Materials;
}) {
  const floors = Math.max(3, Math.floor(spec.size[1] / 2.2));
  const cols = Math.max(3, Math.floor(spec.size[0] / 2.5));

  return (
    <group position={spec.pos} rotation={[0, spec.rot, 0]}>
      <mesh>
        <boxGeometry args={spec.size} />
        <primitive object={spec.mat} attach="material" />
      </mesh>

      <mesh
        position={[
          spec.damage === "left" ? -spec.size[0] * 0.38 : spec.size[0] * 0.38,
          spec.size[1] * 0.08,
          spec.size[2] * 0.51,
        ]}
        rotation={[0, 0, spec.damage === "left" ? -0.28 : 0.28]}
      >
        <boxGeometry args={[spec.size[0] * 0.42, spec.size[1] * 0.75, 0.18]} />
        <primitive object={materials.concreteDark} attach="material" />
      </mesh>

      {Array.from({ length: floors }).map((_, y) =>
        Array.from({ length: cols }).map((_, x) => {
          const edgeDamage =
            (spec.damage === "left" && x === 0 && y > floors * 0.35) ||
            (spec.damage === "right" && x === cols - 1 && y > floors * 0.35) ||
            (spec.damage === "top" && y === floors - 1 && x % 2 === 0);
          if (edgeDamage) return null;

          return (
            <mesh
              key={`window${x}-${y}`}
              position={[
                -spec.size[0] * 0.36 + x * (spec.size[0] * 0.72) / (cols - 1),
                -spec.size[1] * 0.35 + y * 2.05,
                spec.size[2] * 0.515,
              ]}
            >
              <boxGeometry args={[0.72, 0.9, 0.05]} />
              <primitive object={materials.glass} attach="material" />
            </mesh>
          );
        }),
      )}

      <mesh
        position={[0, -spec.size[1] * 0.48, spec.size[2] * 0.57]}
        rotation={[0.08, 0, spec.damage === "left" ? -0.16 : 0.16]}
      >
        <boxGeometry args={[spec.size[0] * 0.9, 0.26, 0.34]} />
        <primitive object={materials.metal} attach="material" />
      </mesh>
    </group>
  );
}

function StreetSetDressing({ materials }: { materials: Materials }) {
  return (
    <group>
      <BurnedVehicle position={[8.5, 0.45, 0]} rotation={-0.7} materials={materials} />
      <BurnedVehicle position={[-7.5, 0.45, -8]} rotation={2.15} materials={materials} />
      <CheckpointSign position={[4.8, 1.35, -10]} rotation={0.25} materials={materials} />
      <CheckpointSign position={[-8.8, 1.2, 1]} rotation={1.8} materials={materials} />
      <CollapsedBeams materials={materials} />
      <SurvivorRubbleCradles materials={materials} />
    </group>
  );
}

function BurnedVehicle({
  position,
  rotation,
  materials,
}: {
  position: [number, number, number];
  rotation: number;
  materials: Materials;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh>
        <boxGeometry args={[2.9, 0.75, 1.35]} />
        <primitive object={materials.metal} attach="material" />
      </mesh>
      <mesh position={[0.1, 0.56, -0.06]}>
        <boxGeometry args={[1.45, 0.56, 1.05]} />
        <primitive object={materials.metal} attach="material" />
      </mesh>
      {[-0.95, 0.95].map((x) =>
        [-0.62, 0.62].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, -0.36, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.32, 0.32, 0.18, 16]} />
            <meshStandardMaterial color="#060606" roughness={0.9} />
          </mesh>
        )),
      )}
      <mesh position={[-1.48, 0.2, 0.03]} rotation={[0.2, 0, 0.05]}>
        <boxGeometry args={[0.08, 0.65, 1.2]} />
        <primitive object={materials.concreteDark} attach="material" />
      </mesh>
    </group>
  );
}

function CheckpointSign({
  position,
  rotation,
  materials,
}: {
  position: [number, number, number];
  rotation: number;
  materials: Materials;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[-0.45, -0.55, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 2.5, 8]} />
        <primitive object={materials.metal} attach="material" />
      </mesh>
      <mesh position={[0.45, -0.55, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 2.5, 8]} />
        <primitive object={materials.metal} attach="material" />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[1.35, 0.55, 0.05]} />
        <primitive object={materials.warning} attach="material" />
      </mesh>
      <mesh position={[0, -0.18, 0.035]}>
        <boxGeometry args={[1.1, 0.08, 0.035]} />
        <meshBasicMaterial color="#17110a" />
      </mesh>
    </group>
  );
}

function CollapsedBeams({ materials }: { materials: Materials }) {
  const beams: { pos: [number, number, number]; rot: [number, number, number]; len: number }[] = [
    { pos: [-4.8, 0.55, -17], rot: [0.05, 0.8, -0.12], len: 6.5 },
    { pos: [5.3, 0.7, -22], rot: [-0.1, -0.55, 0.18], len: 7.5 },
    { pos: [-8, 0.6, -28], rot: [0.18, 0.35, -0.08], len: 5.5 },
    { pos: [8.5, 0.62, -30], rot: [-0.12, 0.95, 0.1], len: 6.2 },
  ];

  return (
    <group>
      {beams.map((b, i) => (
        <mesh key={`beam${i}`} position={b.pos} rotation={b.rot}>
          <boxGeometry args={[b.len, 0.28, 0.34]} />
          <primitive object={materials.metal} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

function SurvivorRubbleCradles({ materials }: { materials: Materials }) {
  const clusters = [
    { center: [-1, 0.1, -24] as [number, number, number], phase: 10 },
    { center: [2, 0.1, -28] as [number, number, number], phase: 31 },
  ];

  return (
    <group>
      {clusters.flatMap((cluster, ci) =>
        Array.from({ length: 12 }).map((_, i) => {
          const a = seed(i + cluster.phase) * Math.PI * 2;
          const r = 0.75 + seed(i + cluster.phase + 5) * 1.2;
          return (
            <mesh
              key={`cradle${ci}-${i}`}
              position={[
                cluster.center[0] + Math.cos(a) * r,
                cluster.center[1] + seed(i + 3) * 0.35,
                cluster.center[2] + Math.sin(a) * r,
              ]}
              rotation={[
                seed(i + 8) * 1.1,
                seed(i + 9) * Math.PI * 2,
                seed(i + 10) * 1.1,
              ]}
              scale={0.25 + seed(i + 11) * 0.5}
            >
              <dodecahedronGeometry args={[1, 0]} />
              <primitive object={materials.concrete} attach="material" />
            </mesh>
          );
        }),
      )}
    </group>
  );
}

function RubbleField({ material }: { material: MeshStandardMaterial }) {
  const items = useMemo(() => {
    const out: {
      pos: [number, number, number];
      rot: [number, number, number];
      scale: [number, number, number];
    }[] = [];

    for (let i = 0; i < 140; i++) {
      const side = seed(i) > 0.5 ? -1 : 1;
      const awayFromAlley = 4 + seed(i + 1) * 24;
      out.push({
        pos: [
          side * awayFromAlley,
          0.09 + seed(i + 4) * 0.45,
          7 - seed(i + 2) * 66,
        ],
        rot: [
          seed(i + 5) * 1.2,
          seed(i + 6) * Math.PI * 2,
          seed(i + 7) * 1.2,
        ],
        scale: [
          0.22 + seed(i + 8) * 0.9,
          0.16 + seed(i + 9) * 0.55,
          0.22 + seed(i + 10) * 0.9,
        ],
      });
    }
    return out;
  }, []);

  return (
    <group>
      {items.map((it, i) => (
        <mesh key={`debris${i}`} position={it.pos} rotation={it.rot} scale={it.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <primitive object={material} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

function SkylineRing() {
  const buildings = useMemo(() => {
    const out: {
      pos: [number, number, number];
      size: [number, number, number];
      tilt: number;
    }[] = [];
    for (let i = 0; i < 34; i++) {
      const t = i / 33;
      const h = 12 + seed(i + 7) * 34;
      out.push({
        pos: [(t - 0.5) * 220 + (seed(i) - 0.5) * 14, h / 2, -130 - seed(i + 30) * 55],
        size: [6 + seed(i + 5) * 14, h, 5 + seed(i + 11) * 8],
        tilt: (seed(i + 13) - 0.5) * 0.08,
      });
    }
    return out;
  }, []);

  return (
    <group>
      {buildings.map((b, i) => (
        <mesh key={`sky${i}`} position={b.pos} rotation={[0, b.tilt * 6, b.tilt]}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color="#080706" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function SmokeColumns() {
  const cols = useMemo(
    () => [
      { pos: [-13, 10, -20], width: 8, height: 22, tint: "#1a1410" },
      { pos: [13, 12, -28], width: 9, height: 26, tint: "#1d1713" },
      { pos: [-22, 13, -52], width: 12, height: 30, tint: "#19140f" },
      { pos: [27, 15, -72], width: 14, height: 34, tint: "#17130f" },
    ] as const,
    [],
  );

  const groups = useRef<(Group | null)[]>([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    groups.current.forEach((g, i) => {
      if (!g) return;
      g.position.y = cols[i].pos[1] + Math.sin(t * 0.22 + i) * 0.35;
      g.rotation.y = Math.sin(t * 0.07 + i) * 0.18;
    });
  });

  return (
    <group>
      {cols.map((c, i) => (
        <group
          key={`smoke${i}`}
          ref={(el) => {
            groups.current[i] = el;
          }}
          position={c.pos}
        >
          <mesh>
            <planeGeometry args={[c.width, c.height]} />
            <meshBasicMaterial color={c.tint} transparent opacity={0.5} depthWrite={false} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[c.width, c.height]} />
            <meshBasicMaterial color={c.tint} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function BurningGlow() {
  const points = useMemo(
    () => [
      { pos: [-10, 0.6, -17], color: "#ff6a30", base: 1.3, period: 1.7, phase: 0 },
      { pos: [9, 0.7, -25], color: "#ff8a40", base: 1.1, period: 2.3, phase: 1.4 },
      { pos: [-20, 2.2, -50], color: "#ff5a28", base: 1.6, period: 1.4, phase: 2.6 },
      { pos: [24, 3.5, -68], color: "#ff7038", base: 1.2, period: 2.0, phase: 0.8 },
    ],
    [],
  );

  const meshes = useRef<(Mesh | null)[]>([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    meshes.current.forEach((m, i) => {
      if (!m) return;
      const p = points[i];
      const pulse = (Math.sin(t / p.period + p.phase) + 1) * 0.5;
      const mat = m.material as { emissiveIntensity?: number };
      if (typeof mat.emissiveIntensity === "number") {
        mat.emissiveIntensity = p.base + pulse * 2.3;
      }
    });
  });

  return (
    <group>
      {points.map((p, i) => (
        <mesh
          key={`fire${i}`}
          ref={(el) => {
            meshes.current[i] = el;
          }}
          position={p.pos as [number, number, number]}
        >
          <sphereGeometry args={[0.65, 12, 8]} />
          <meshStandardMaterial
            color={p.color}
            emissive={p.color}
            emissiveIntensity={p.base}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function seed(i: number): number {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}
