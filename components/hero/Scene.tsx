"use client";

import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
import { createTriplanarMaterial } from "./triplanarMaterial";

/**
 * Hero environment — layered post-disaster cityscape.
 *
 * Geometry comes from converted EAM165 GLBs (the OBJ pipeline lost the source
 * V-Ray texture references). To get production-quality surfaces without doing
 * manual UV work in Blender, we apply a *triplanar-projected* PBR material
 * built from the KBS105 KitBash kit's PBR maps (concrete A, damaged bricks,
 * rusted metal). Triplanar projection samples by world position, not UVs, so
 * the textures tile correctly across any geometry regardless of what the
 * source UVs were.
 *
 * Each building is assigned a material variant for visual heterogeneity.
 *
 * Depth layers (camera path: z=26 → z=-14 → back, ~12s loop):
 *   • Skyline ring   (z ≈ -150)  — dark silhouettes against fog
 *   • Far layer      (z ≈ -60..-80)
 *   • Mid layer      (z ≈ -30..-50)
 *   • Hero layer     (z ≈ -10..-25, camera passes between)
 *   • Clutter        (z ≈ 0..-22) — vehicles, signs, rubble
 *   • Smoke columns + emissive fire glow
 */
const USE_PRIMITIVES_FALLBACK = false;

export function Scene() {
  if (USE_PRIMITIVES_FALLBACK) return null;
  return <BakedEnvironment />;
}

// ---- Preload GLBs ----
useGLTF.preload("/models/building-apartment.glb");
useGLTF.preload("/models/building-facade.glb");
useGLTF.preload("/models/building-multistory.glb");
useGLTF.preload("/models/building-mansion.glb");
useGLTF.preload("/models/vehicle-taxi.glb");
useGLTF.preload("/models/rubble-large.glb");
useGLTF.preload("/models/street-signs.glb");

type MaterialVariant = "concrete" | "bricks" | "rustMetal";

type Placement = {
  src: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Desired height of the asset in scene units */
  targetHeight: number;
  /** Which triplanar material variant to use */
  variant: MaterialVariant;
  /** Subtle tint multiplier (per-instance variation on top of base PBR) */
  tint?: string;
};

// ---- Placements ----
const BUILDINGS: Placement[] = [
  // HERO LAYER
  { src: "/models/building-apartment.glb", position: [-12, 0, -16], rotation: [0, 0.2, 0], targetHeight: 14, variant: "bricks", tint: "#a89888" },
  { src: "/models/building-mansion.glb", position: [13, 0, -20], rotation: [0, -0.55, 0], targetHeight: 13, variant: "concrete", tint: "#9a8e80" },

  // MID LAYER
  { src: "/models/building-multistory.glb", position: [-22, 0, -36], rotation: [0, 0.3, 0], targetHeight: 17, variant: "concrete", tint: "#8a8278" },
  { src: "/models/building-mansion.glb", position: [22, 0, -38], rotation: [0, -0.4, 0], targetHeight: 15, variant: "bricks", tint: "#9c8a78" },
  { src: "/models/building-apartment.glb", position: [4, 0, -42], rotation: [0, 1.5, 0], targetHeight: 13, variant: "concrete", tint: "#8c8478" },
  // Moved off the central alley axis (was at -4,-32 which blocked the deep
  // rescue zone). Now at -16,-34 — flanks the alley from the west, leaves
  // x∈[-2,3] clear all the way back to z=-32.
  { src: "/models/building-multistory.glb", position: [-16, 0, -34], rotation: [0, -0.8, 0], targetHeight: 12, variant: "bricks", tint: "#a08a78" },

  // FAR LAYER
  { src: "/models/building-facade.glb", position: [-8, 0, -68], rotation: [0, 0.05, 0], targetHeight: 22, variant: "concrete", tint: "#706a60" },
  { src: "/models/building-multistory.glb", position: [28, 0, -64], rotation: [0, -0.6, 0], targetHeight: 20, variant: "concrete", tint: "#605a52" },
  { src: "/models/building-mansion.glb", position: [-32, 0, -72], rotation: [0, 0.6, 0], targetHeight: 19, variant: "bricks", tint: "#766859" },
  { src: "/models/building-apartment.glb", position: [40, 0, -78], rotation: [0, -1.2, 0], targetHeight: 18, variant: "concrete", tint: "#5a544a" },
];

const CLUTTER: Placement[] = [
  // Vehicles — rusted metal
  { src: "/models/vehicle-taxi.glb", position: [9, 0, 1], rotation: [0, -0.7, 0], targetHeight: 1.6, variant: "rustMetal", tint: "#a08070" },
  { src: "/models/vehicle-taxi.glb", position: [-6, 0, -8], rotation: [0, 2.2, 0.15], targetHeight: 1.5, variant: "rustMetal", tint: "#8c7060" },

  // Signs — concrete posts + metal plates
  { src: "/models/street-signs.glb", position: [5, 0, -10], rotation: [0, 0.3, 0], targetHeight: 2.8, variant: "rustMetal", tint: "#9a8478" },
  { src: "/models/street-signs.glb", position: [-9, 0, 0], rotation: [0, 1.8, 0], targetHeight: 2.4, variant: "rustMetal", tint: "#806c5c" },

  // Rubble — concrete
  { src: "/models/rubble-large.glb", position: [-2, 0, -4], rotation: [0, 1.2, 0], targetHeight: 1.4, variant: "concrete", tint: "#8c8478" },
  { src: "/models/rubble-large.glb", position: [3, 0, -16], rotation: [0, -0.4, 0], targetHeight: 1.8, variant: "concrete", tint: "#928678" },
  { src: "/models/rubble-large.glb", position: [-7, 0, -22], rotation: [0, 2.1, 0], targetHeight: 1.6, variant: "concrete", tint: "#827a6c" },
  { src: "/models/rubble-large.glb", position: [14, 0, -10], rotation: [0, 0.9, 0], targetHeight: 1.3, variant: "concrete", tint: "#8e8270" },
];

function BakedEnvironment() {
  // Load all PBR texture sets once and build shared materials per variant.
  const concrete = useTexture({
    map: "/textures/concrete-a_basecolor.jpg",
    normalMap: "/textures/concrete-a_normal.jpg",
    roughnessMap: "/textures/concrete-a_roughness.jpg",
  });
  const bricks = useTexture({
    map: "/textures/bricks-damage_basecolor.jpg",
    normalMap: "/textures/bricks-damage_normal.jpg",
    roughnessMap: "/textures/bricks-damage_roughness.jpg",
  });
  const rustMetal = useTexture({
    map: "/textures/metal-rust_basecolor.jpg",
    normalMap: "/textures/metal-rust_normal.jpg",
    roughnessMap: "/textures/metal-rust_roughness.jpg",
  });

  const materials = useMemo(
    () => ({
      concrete: createTriplanarMaterial({
        basecolor: concrete.map,
        normalMap: concrete.normalMap,
        roughnessMap: concrete.roughnessMap,
        scale: 0.16,
        roughness: 1.0,
        metalness: 0.0,
        name: "concrete",
      }),
      bricks: createTriplanarMaterial({
        basecolor: bricks.map,
        normalMap: bricks.normalMap,
        roughnessMap: bricks.roughnessMap,
        scale: 0.22,
        roughness: 0.95,
        metalness: 0.0,
        name: "bricks",
      }),
      rustMetal: createTriplanarMaterial({
        basecolor: rustMetal.map,
        normalMap: rustMetal.normalMap,
        roughnessMap: rustMetal.roughnessMap,
        scale: 0.65,
        roughness: 0.7,
        metalness: 0.55,
        name: "rustMetal",
      }),
    }),
    [concrete, bricks, rustMetal],
  );

  return (
    <group>
      <Ground />
      <SkylineRing />
      {BUILDINGS.map((p, i) => (
        <RuinAsset key={`b${i}`} {...p} baseMaterial={materials[p.variant]} />
      ))}
      {CLUTTER.map((p, i) => (
        <RuinAsset key={`c${i}`} {...p} baseMaterial={materials[p.variant]} />
      ))}
      <ProceduralDebris baseMaterial={materials.concrete} />
      <SmokeColumns />
      <BurningGlow />
    </group>
  );
}

// ---- Ground ----
function Ground() {
  const patches = useMemo(() => {
    const out: { pos: [number, number, number]; r: number; rot: number; shade: string }[] = [];
    const seed = (i: number) => {
      const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    for (let i = 0; i < 14; i++) {
      out.push({
        pos: [(seed(i) - 0.5) * 80, 0.005, -10 - seed(i + 20) * 60],
        r: 3 + seed(i + 40) * 9,
        rot: seed(i) * Math.PI,
        shade: `rgb(${10 + Math.round(seed(i + 50) * 14)}, ${8 + Math.round(seed(i + 60) * 10)}, ${6 + Math.round(seed(i + 70) * 8)})`,
      });
    }
    return out;
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -30]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#13110d" roughness={1} />
      </mesh>
      {patches.map((p, i) => (
        <mesh key={`gp${i}`} rotation={[-Math.PI / 2, 0, p.rot]} position={p.pos}>
          <circleGeometry args={[p.r, 8]} />
          <meshStandardMaterial color={p.shade} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

// ---- Skyline silhouettes ----
function SkylineRing() {
  const buildings = useMemo(() => {
    const out: {
      pos: [number, number, number];
      size: [number, number, number];
      tilt: number;
    }[] = [];
    const seed = (i: number) => {
      const v = Math.sin(i * 41.9173 + 11.227) * 9182.21;
      return v - Math.floor(v);
    };
    const count = 28;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const x = (t - 0.5) * 200 + (seed(i) - 0.5) * 12;
      const z = -130 - seed(i + 100) * 50;
      const w = 6 + seed(i + 5) * 14;
      const h = 12 + seed(i + 7) * 32;
      const d = 5 + seed(i + 11) * 8;
      out.push({
        pos: [x, h / 2, z],
        size: [w, h, d],
        tilt: (seed(i + 13) - 0.5) * 0.08,
      });
    }
    return out;
  }, []);

  return (
    <group>
      {buildings.map((b, i) => (
        <mesh key={`sk${i}`} position={b.pos} rotation={[0, b.tilt * 6, b.tilt]}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color="#0a0907" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

// ---- Smoke columns ----
function SmokeColumns() {
  const cols = useMemo(
    () => [
      { pos: [-14, 12, -52], width: 10, height: 24, tint: "#1a1410" },
      { pos: [18, 14, -68], width: 12, height: 30, tint: "#1c1612" },
      { pos: [-26, 10, -78], width: 9, height: 22, tint: "#181410" },
      { pos: [30, 16, -86], width: 14, height: 34, tint: "#1a1410" },
    ] as const,
    [],
  );

  const groups = useRef<(Group | null)[]>([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    groups.current.forEach((g, i) => {
      if (!g) return;
      g.position.y = (cols[i].pos[1] as number) + Math.sin(t * 0.2 + i) * 0.3;
    });
  });

  return (
    <group>
      {cols.map((c, i) => (
        <group
          key={`sm${i}`}
          ref={(el) => {
            groups.current[i] = el;
          }}
          position={c.pos as unknown as [number, number, number]}
        >
          <mesh>
            <planeGeometry args={[c.width, c.height]} />
            <meshBasicMaterial color={c.tint} transparent opacity={0.55} depthWrite={false} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[c.width, c.height]} />
            <meshBasicMaterial color={c.tint} transparent opacity={0.55} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---- Burning embers ----
function BurningGlow() {
  const points = useMemo(
    () => [
      { pos: [-12, 10, -54], color: "#ff6a30", base: 1.5, period: 1.7, phase: 0 },
      { pos: [17, 6, -64], color: "#ff8a40", base: 1.2, period: 2.3, phase: 1.4 },
      { pos: [-26, 8, -74], color: "#ff5a28", base: 1.8, period: 1.4, phase: 2.6 },
      { pos: [9, 14, -82], color: "#ff7038", base: 1.4, period: 2.0, phase: 0.8 },
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
        mat.emissiveIntensity = p.base + pulse * 2.5;
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
          <sphereGeometry args={[0.6, 8, 8]} />
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

// ---- Loaded asset with auto-sizing + triplanar PBR ----
function RuinAsset({
  src,
  position,
  rotation = [0, 0, 0],
  targetHeight,
  tint = "#ffffff",
  baseMaterial,
}: Placement & { baseMaterial: MeshStandardMaterial }) {
  const { scene } = useGLTF(src);
  const innerRef = useRef<Group>(null);
  const [computedScale, setComputedScale] = useState(1);
  const [computedOffset, setComputedOffset] = useState<[number, number, number]>([
    0, 0, 0,
  ]);

  // Per-instance material: clone the variant + apply the tint multiplier.
  // Cloning a material preserves the onBeforeCompile patch (shaders are
  // shared by program cache key).
  const instanceMaterial = useMemo(() => {
    const m = baseMaterial.clone();
    m.color.set(tint);
    return m;
  }, [baseMaterial, tint]);

  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh) {
        const m = o as Mesh;
        m.material = instanceMaterial;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    return c;
  }, [scene, instanceMaterial]);

  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const bbox = new Box3().setFromObject(cloned);
    if (!isFinite(bbox.min.y) || !isFinite(bbox.max.y)) return;
    const size = new Vector3();
    bbox.getSize(size);
    if (size.y <= 0) return;

    const s = targetHeight / size.y;
    const center = new Vector3();
    bbox.getCenter(center);
    setComputedScale(s);
    setComputedOffset([-center.x * s, -bbox.min.y * s, -center.z * s]);
  }, [cloned, targetHeight]);

  return (
    <group position={position} rotation={rotation}>
      <group ref={innerRef} scale={computedScale} position={computedOffset}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}

// ---- Procedural debris ----
function ProceduralDebris({ baseMaterial }: { baseMaterial: MeshStandardMaterial }) {
  const items = useMemo(() => {
    const out: {
      pos: [number, number, number];
      rot: [number, number, number];
      scale: number;
    }[] = [];
    const seed = (i: number) => {
      const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    for (let i = 0; i < 90; i++) {
      const a = seed(i) * Math.PI * 2;
      const r = 5 + seed(i + 1) * 25;
      out.push({
        pos: [Math.cos(a) * r, 0.12 + seed(i + 4) * 0.4, -4 - seed(i + 2) * 38],
        rot: [seed(i + 5) * 1.2, seed(i + 6) * Math.PI * 2, seed(i + 7) * 1.2],
        scale: 0.18 + seed(i + 8) * 0.6,
      });
    }
    return out;
  }, []);

  return (
    <group>
      {items.map((it, i) => (
        <mesh key={`d${i}`} position={it.pos} rotation={it.rot} scale={it.scale} material={baseMaterial}>
          <dodecahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
    </group>
  );
}
