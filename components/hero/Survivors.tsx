"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  getLoopTime,
  LOOP_SECONDS,
  SURVIVORS,
  Survivor,
} from "./missionTimeline";

// CC0 / freely-redistributable humanoid GLB from the three.js examples
// (originally a Mixamo rig). Source pulled into public/models/ at build-time
// so the marketing site doesn't need a runtime fetch from threejs.org.
const MODEL_URL = "/models/survivor.glb";
useGLTF.preload(MODEL_URL);

const FIGURE_HEIGHT = 1.75; // adult-ish, in world units (≈ metres)
// How much of the figure pokes above local y=0. The rest is sunk so the
// silhouette reads as trapped beneath rubble rather than standing on it.
const VISIBLE_HEIGHT = 0.65;

/**
 * Visualizes the two trapped survivors in the world. Each survivor:
 *
 *   • a rigged humanoid GLB, sunk into the ground so only the upper body
 *     pokes through — reads as a partially-buried civilian
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

function idToHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function SurvivorMarker({ data }: { data: Survivor }) {
  const heatPlume = useRef<Mesh>(null);
  const pulseRing = useRef<Mesh>(null);
  const innerRef = useRef<Group>(null);
  const materialsRef = useRef<MeshStandardMaterial[]>([]);

  const gltf = useGLTF(MODEL_URL);

  // SkeletonUtils.clone — not scene.clone(true) — because the model is a
  // SkinnedMesh. Plain Object3D cloning leaves each instance referencing the
  // *original* skeleton, so playing the idle clip on one survivor animates
  // both. SkeletonUtils rebinds bones per clone.
  const cloned = useMemo(() => {
    const c = cloneSkeleton(gltf.scene) as Group;
    const mats: MeshStandardMaterial[] = [];
    c.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      // Override every material with a uniform dim "in-shadow under rubble"
      // tone so the soldier textures don't leak through — we want a
      // generic-civilian silhouette, not a soldier.
      const mat = new MeshStandardMaterial({
        color: "#2a1f18",
        emissive: "#ff5a30",
        emissiveIntensity: 0,
        roughness: 0.95,
        metalness: 0,
      });
      m.material = mat;
      m.castShadow = false;
      m.receiveShadow = false;
      mats.push(mat);
    });
    materialsRef.current = mats;
    return c;
  }, [gltf.scene]);

  const { actions } = useAnimations(gltf.animations, cloned);

  // Hold a single, arms-down frame so the figure isn't stuck in T-pose with
  // arms jutting horizontally out of the rubble. We don't want them
  // *animated* — just posed.
  useEffect(() => {
    if (!actions) return;
    const names = Object.keys(actions);
    const pick = names.find((n) => /idle/i.test(n)) ?? names[0];
    const action = pick ? actions[pick] : null;
    if (!action) return;
    action.reset();
    action.play();
    action.paused = true;
    action.time = 0;
  }, [actions]);

  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const bbox = new Box3().setFromObject(cloned);
    if (!isFinite(bbox.min.y) || !isFinite(bbox.max.y)) return;
    const size = new Vector3();
    bbox.getSize(size);
    if (size.y <= 0) return;
    const s = FIGURE_HEIGHT / size.y;
    const center = new Vector3();
    bbox.getCenter(center);
    // Place the model so its feet sit at local y = VISIBLE_HEIGHT - FIGURE_HEIGHT
    // (well below 0) and its head ends up at local y = VISIBLE_HEIGHT.
    const feetLocalY = VISIBLE_HEIGHT - FIGURE_HEIGHT;
    innerRef.current.scale.setScalar(s);
    innerRef.current.position.set(
      -center.x * s,
      feetLocalY - bbox.min.y * s,
      -center.z * s,
    );
  }, [cloned]);

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

    // Body itself emits a faint warmth once confirmed
    for (const m of materialsRef.current) {
      m.emissiveIntensity = confirm * 0.6;
    }
  });

  // Deterministic yaw per id so the two survivors don't pose identically
  // but stay stable across re-renders.
  const yaw = (idToHash(data.id) % 360) * (Math.PI / 180);

  return (
    <group position={data.position}>
      {/* Rigged civilian silhouette — most of the body is buried */}
      <group rotation={[0, yaw, 0]}>
        <group ref={innerRef}>
          <primitive object={cloned} />
        </group>
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
