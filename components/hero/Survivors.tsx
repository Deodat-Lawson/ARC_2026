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

// Auto-scaled so the OBJ's longest axis becomes FIGURE_EXTENT in world units.
// The relay drone POV sits at ~22m altitude — anything smaller than ~8m on the
// ground gets lost in the warm fog, so we err on the side of large here.
const FIGURE_EXTENT = 2.2;

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

/** Bright warm tint + strong emissive — the MTL ships a flat 50% gray, which
 *  reads as "invisible" against the dark warm fog from the relay POV. */
function prepareMaterials(root: Group, materialsRef: Material[]): void {
  materialsRef.length = 0;
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const m = mesh.material as MeshPhongMaterial;
    m.color = new Color("#d4a85a");
    m.emissive = new Color("#ff7030");
    m.emissiveIntensity = 1.1;
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
      (m as MeshPhongMaterial).emissiveIntensity = 1.1 + confirm * 0.6;
    }
  });

  const yaw = (idToHash(data.id) % 360) * (Math.PI / 180);

  return (
    <group position={[data.position[0], 0, data.position[2]]}>
      <group rotation={[0, yaw, 0]}>
        <group ref={innerRef}>
          <primitive object={cloned} />
        </group>
      </group>

      <mesh ref={heatPlume} position={[0, 1.4, 0]}>
        <cylinderGeometry args={[0.09, 0.2, 2.8, 12, 1, true]} />
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
        <ringGeometry args={[0.6, 0.72, 36]} />
        <meshBasicMaterial color="#ffa040" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
