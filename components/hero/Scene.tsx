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
  Texture,
  Vector3,
} from "three";
import { createTriplanarMaterial } from "./triplanarMaterial";
import {
  MATERIALS,
  MaterialId,
  ResolvedPlacement,
  getPreloadGlbs,
  getResolvedPlacements,
} from "./sceneMap";

/**
 * Hero environment — layered post-disaster cityscape.
 *
 * What lives here vs. elsewhere:
 *   • THIS file owns rendering: ground, skyline ring, smoke, fire, debris,
 *     and the loop that instantiates every placement.
 *   • [sceneMap.ts](sceneMap.ts) owns the materials registry, asset catalog,
 *     regions, and placements. Edit there to add / move objects.
 *   • [SceneMapDebug.tsx](SceneMapDebug.tsx) renders a top-down minimap of
 *     the same data so you can see the layout while flying around.
 */

export function Scene() {
  return <BakedEnvironment />;
}

// Auto-preload every GLB the catalog references — no duplicate manual list.
getPreloadGlbs().forEach((src) => useGLTF.preload(src));

function BakedEnvironment() {
  const materials = useMaterials();
  const placements = getResolvedPlacements();

  return (
    <group>
      <Ground />
      <SkylineRing />
      {placements.map((p) => (
        <RuinAsset key={p.id} entry={p} baseMaterial={materials[p.materialId]} />
      ))}
      <ProceduralDebris baseMaterial={materials.concrete} />
      <SmokeColumns />
      <BurningGlow />
    </group>
  );
}

// ---- KBS105 material palette ----
// One explicit useTexture call per variant. Previously this was a single
// useTexture call across a dynamic flat-key object; if drei resolved any one
// key to undefined the material's `map` would silently become null and the
// surface rendered as flat tint. Per-variant calls (with statically-known
// keys) eliminate that failure mode — useTexture suspends until each set is
// fully loaded.
function useMaterials(): Record<MaterialId, MeshStandardMaterial> {
  const concrete = useTexture({
    map: MATERIALS.concrete.basecolor,
    normalMap: MATERIALS.concrete.normalMap,
    roughnessMap: MATERIALS.concrete.roughnessMap,
  });
  const bricks = useTexture({
    map: MATERIALS.bricks.basecolor,
    normalMap: MATERIALS.bricks.normalMap,
    roughnessMap: MATERIALS.bricks.roughnessMap,
  });
  const plaster = useTexture({
    map: MATERIALS.plaster.basecolor,
    normalMap: MATERIALS.plaster.normalMap,
    roughnessMap: MATERIALS.plaster.roughnessMap,
  });
  const metal = useTexture({
    map: MATERIALS.metal.basecolor,
    normalMap: MATERIALS.metal.normalMap,
    roughnessMap: MATERIALS.metal.roughnessMap,
  });

  return useMemo(() => {
    const build = (
      id: MaterialId,
      t: { map: Texture; normalMap: Texture; roughnessMap: Texture },
    ) => {
      const def = MATERIALS[id];
      return createTriplanarMaterial({
        basecolor: t.map,
        normalMap: t.normalMap,
        roughnessMap: t.roughnessMap,
        scale: def.triplanarScale,
        roughness: def.roughness,
        metalness: def.metalness,
        name: id,
      });
    };
    return {
      concrete: build("concrete", concrete),
      bricks: build("bricks", bricks),
      plaster: build("plaster", plaster),
      metal: build("metal", metal),
    };
  }, [concrete, bricks, plaster, metal]);
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

// ---- Skyline silhouettes (deep backdrop) ----
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
      // Deep silhouette ring — far enough that the FAR LAYER placements
      // (z ≈ -60..-80, see sceneMap PLACEMENTS) and the fog falloff combine
      // to read these as a horizon city, not as objects. Don't pull these
      // forward without also pushing the fog far in HeroCanvas.tsx.
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

// ---- Loaded GLB with auto-sizing + triplanar PBR ----
function RuinAsset({
  entry,
  baseMaterial,
}: {
  entry: ResolvedPlacement;
  baseMaterial: MeshStandardMaterial;
}) {
  const { scene } = useGLTF(entry.glb);
  const innerRef = useRef<Group>(null);
  const [computedScale, setComputedScale] = useState(1);
  const [computedOffset, setComputedOffset] = useState<[number, number, number]>([
    0, 0, 0,
  ]);

  // Per-instance material so the per-entry tint doesn't bleed across siblings.
  // Cloning preserves the onBeforeCompile patch (programs share via cache key).
  const instanceMaterial = useMemo(() => {
    const m = baseMaterial.clone();
    if (entry.tint) m.color.set(entry.tint);
    return m;
  }, [baseMaterial, entry.tint]);

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
    // Measure on the SOURCE scene, not `cloned`. setFromObject walks world
    // matrices; `cloned` is parented inside the rotated outer group, so on
    // any pass where the outer's matrixWorld is already up-to-date (HMR,
    // Suspense replay, dep-driven re-run) the resulting bbox lives in world
    // space *with the yaw applied*. Subtracting that as an inner-group offset
    // re-rotates it through the outer group on render, displacing the model
    // by `≈ 2·|entry.position|·sin(yaw/2)` — tens of units for back-layer
    // placements like far-apt-SE (yaw=-1.20, |pos|≈89). The source scene
    // sits unparented in drei's GLB cache; its matrixWorld stays identity,
    // so the bbox is unambiguously in cloned-local space.
    const bbox = new Box3().setFromObject(scene);
    if (!isFinite(bbox.min.y) || !isFinite(bbox.max.y)) return;
    const size = new Vector3();
    bbox.getSize(size);
    if (size.y <= 0) return;

    const s = entry.height / size.y;
    const center = new Vector3();
    bbox.getCenter(center);
    setComputedScale(s);
    setComputedOffset([-center.x * s, -bbox.min.y * s, -center.z * s]);
  }, [scene, entry.height]);

  return (
    <group position={entry.position} rotation={entry.rotation} name={entry.id}>
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
