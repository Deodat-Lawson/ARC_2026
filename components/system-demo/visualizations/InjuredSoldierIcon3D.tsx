"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  Box3,
  Color,
  Group,
  Loader,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

/**
 * Tiny inline 3D render of public/models/injured-soldier.obj for tactical
 * map markers. Top-down orthographic camera, soft warm lighting — the
 * silhouette stays legible at ~30 SVG units inside a foreignObject.
 *
 * Shares no state with the Hero scene's Survivors loader so this can mount
 * independently when the M2 panel scrolls into view.
 */

const MODELS_PATH = "/models/";
const MODEL_OBJ = "injured-soldier.obj";
const MODEL_MTL = "injured-soldier.mtl";
const ASSET_URL = `${MODELS_PATH}${MODEL_OBJ}`;

class InjuredSoldierPackLoader extends Loader<Group> {
  override load(
    _url: string,
    onLoad: (data: Group) => void,
    onProgress?: (e: ProgressEvent<EventTarget>) => void,
    onError?: (e: unknown) => void,
  ): void {
    const mtl = new MTLLoader(this.manager);
    mtl.setPath(MODELS_PATH);
    mtl.setResourcePath(MODELS_PATH);
    const onProg = onProgress ?? (() => undefined);
    const onErr = onError ?? ((e: unknown) => console.error(e));
    mtl.load(
      MODEL_MTL,
      (creator) => {
        creator.preload();
        const obj = new OBJLoader(this.manager);
        obj.setMaterials(creator);
        obj.setPath(MODELS_PATH);
        obj.load(MODEL_OBJ, onLoad, onProg, onErr);
      },
      onProg,
      onErr,
    );
  }
}

useLoader.preload(InjuredSoldierPackLoader, ASSET_URL);

function FigureMesh() {
  const prototype = useLoader(InjuredSoldierPackLoader, ASSET_URL);
  const innerRef = useRef<Group>(null);

  const cloned = useMemo(() => {
    const root = prototype.clone(true) as Group;
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const m = mesh.material as MeshStandardMaterial;
      // Mint-tinted so the figure reads as part of M2's tactical palette.
      m.color = new Color("#5dffb4");
      m.emissive = new Color("#1a3a28");
      m.emissiveIntensity = 0.6;
      m.roughness = 0.7;
      m.metalness = 0.0;
    });
    return root;
  }, [prototype]);

  // Frame the source bbox into a 1x1 box centered at origin so the
  // orthographic camera at zoom=1 fills the canvas with the figure.
  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const bbox = new Box3().setFromObject(cloned);
    const size = new Vector3();
    bbox.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    if (longest <= 0) return;
    const s = 0.9 / longest;
    const center = new Vector3();
    bbox.getCenter(center);
    innerRef.current.scale.setScalar(s);
    innerRef.current.position.set(-center.x * s, -center.y * s, -center.z * s);
  }, [cloned]);

  // OBJ is a prone figure with its long axis along world Z; rotate so the
  // body reads horizontally on the tactical map (long axis along screen X).
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <group ref={innerRef}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}

export function InjuredSoldierIcon3D() {
  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [0, 4, 0], zoom: 80, near: 0.1, far: 20 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      style={{ background: "transparent" }}
    >
      {/* Top-down lighting: warm key from above + cool fill from the front
          edge so the silhouette has shape, not flat tone. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[2, 5, 2]} intensity={1.4} color="#ffd6a0" />
      <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#5dffb4" />
      <FigureMesh />
    </Canvas>
  );
}
