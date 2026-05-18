"use client";

import { useFrame, useLoader } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  Box3,
  Color,
  Group,
  Loader,
  Material,
  Mesh,
  MeshPhongMaterial,
  Vector3,
} from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  getLoopTime,
  LOOP_SECONDS,
  SURVIVORS,
  Survivor,
} from "./missionTimeline";

/** Same folder as OBJ — must match `/public/models/` at runtime */
const MODELS_PATH = "/models/";
const MODEL_OBJ = "injured-soldier.obj";
const MODEL_MTL = "injured-soldier.mtl";

const MODEL_ASSET_URL = `${MODELS_PATH}${MODEL_OBJ}`;

/**
 * Loads injured-soldier.mtl then injured-soldier.obj as one Suspense asset
 * for `useLoader` (three's OBJ export ships split MTL with broken paths).
 */
class InjuredSoldierPackLoader extends Loader<Group> {
  override load(
    _url: string,
    onLoad: (data: Group) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (error: unknown) => void,
  ): void {
    const mtlLoader = new MTLLoader(this.manager);
    mtlLoader.setPath(MODELS_PATH);
    mtlLoader.setResourcePath(MODELS_PATH);

    const onProg = onProgress ?? (() => undefined);
    const onErr =
      onError ??
      ((e: unknown) => {
        console.error(e);
      });

    mtlLoader.load(
      MODEL_MTL,
      (creator) => {
        creator.preload();
        const objLoader = new OBJLoader(this.manager);
        objLoader.setMaterials(creator);
        objLoader.setPath(MODELS_PATH);
        objLoader.load(MODEL_OBJ, onLoad, onProg, onErr);
      },
      onProg,
      onErr,
    );
  }
}

useLoader.preload(InjuredSoldierPackLoader, MODEL_ASSET_URL);

// The injured-soldier OBJ is a posed (prone) figure. Its source bbox is
// roughly X=428, Y=92, Z=240 — Y is the smallest axis (body thickness when
// lying down), not the height. Scaling by Y alone would stretch the body to
// ~8m wide. We scale by the LONGEST dimension so the whole figure fits into
// FIGURE_EXTENT regardless of which axis the source uses for length.
const FIGURE_EXTENT = 6.0; // length of the prone body in world units (≈ metres)

/**
 * Visualizes the two trapped survivors at `SURVIVORS[]` placement: an
 * injured-soldier OBJ (posed prone — already lying down in the source),
 * plus a thermal plume and pulse ring driven by identification / rescue
 * times.
 */
export function Survivors() {
  const prototype = useLoader(InjuredSoldierPackLoader, MODEL_ASSET_URL);

  return (
    <group>
      {SURVIVORS.map((s) => (
        <SurvivorMarker key={s.id} data={s} prototype={prototype} />
      ))}
    </group>
  );
}

function idToHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Tint to a fatigued olive-drab and pre-warm an emissive for the heat pulse. */
function prepareMaterials(root: Group, materialsRef: Material[]): void {
  materialsRef.length = 0;
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const m = mesh.material as MeshPhongMaterial;
    // Olive-drab fatigues — readable against the dark warm fog, not so bright
    // it competes with the drones.
    m.color = new Color("#4a4233");
    m.emissive = new Color("#2a1408");
    m.emissiveIntensity = 0.35;
    materialsRef.push(m);
  });
}

function SurvivorMarker({
  data,
  prototype,
}: {
  data: Survivor;
  prototype: Group;
}) {
  const heatPlume = useRef<Mesh>(null);
  const pulseRing = useRef<Mesh>(null);
  const innerRef = useRef<Group>(null);

  /** Materials mutated in useFrame — one list per survivor instance */
  const materialsRef = useRef<Material[]>([]);

  const cloned = useMemo(() => {
    const root = prototype.clone(true) as Group;
    prepareMaterials(root, materialsRef.current);
    return root;
  }, [prototype]);

  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const bbox = new Box3().setFromObject(cloned);
    if (!isFinite(bbox.min.y) || !isFinite(bbox.max.y)) return;
    const size = new Vector3();
    bbox.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    if (longest <= 0) return;
    // Scale uniformly so the source bbox's longest axis (the body length on
    // a prone figure) becomes FIGURE_EXTENT. Centre over the survivor's
    // ground position and rest the bottom of the bbox on local y=0 so the
    // figure sits on the ground rather than floating or sinking.
    const s = FIGURE_EXTENT / longest;
    const center = new Vector3();
    bbox.getCenter(center);
    innerRef.current.scale.setScalar(s);
    innerRef.current.position.set(
      -center.x * s,
      -bbox.min.y * s,
      -center.z * s,
    );
  }, [cloned]);

  useFrame(() => {
    const t = getLoopTime();
    let heat = 0;
    let confirm = 0;
    if (t >= data.identifyAtT) {
      heat = Math.min(1, (t - data.identifyAtT) / 0.6);
    }
    if (t >= data.rescuedAtT) {
      confirm = Math.min(1, (t - data.rescuedAtT) / 0.5);
    }
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
      mat.opacity = Math.min(1, intensity * 0.55);
      mat.emissiveIntensity = intensity * 3 * pulse;
    }

    if (pulseRing.current) {
      const cycle = (t * 1.5) % 1;
      const scale = 1 + cycle * 1.6;
      pulseRing.current.scale.set(scale, scale, scale);
      const mat = pulseRing.current.material as { opacity?: number };
      mat.opacity = heat * (1 - cycle) * 0.6 + confirm * 0.5;
    }

    for (const m of materialsRef.current) {
      // Baseline emissive (0.35) keeps the body legible against the warm
      // fog; the rescue confirmation adds an extra warm glow on top.
      (m as MeshPhongMaterial).emissiveIntensity = 0.35 + confirm * 0.6;
    }
  });

  const yaw = (idToHash(data.id) % 360) * (Math.PI / 180);

  // Marker anchors at ground (y=0). `data.position.y` is used by other
  // mission code (dog/drone overwatch references) but here the figure must
  // physically rest on the ground regardless.
  return (
    <group position={[data.position[0], 0, data.position[2]]}>
      <group rotation={[0, yaw, 0]}>
        <group ref={innerRef}>
          <primitive object={cloned} />
        </group>
      </group>

      <mesh ref={heatPlume} position={[0, 3.8, 0]}>
        <cylinderGeometry args={[0.25, 0.55, 7.6, 12, 1, true]} />
        <meshStandardMaterial
          color="#ff7040"
          emissive="#ff7040"
          emissiveIntensity={0}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>

      <mesh ref={pulseRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.6, 1.95, 36]} />
        <meshBasicMaterial color="#ffa040" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
