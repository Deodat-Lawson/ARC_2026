"use client";

import { useFBX, useTexture } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Texture,
  Vector3,
} from "three";

/**
 * Loads an FBX at runtime and applies an externally-supplied color (and
 * optional normal) texture as the diffuse map.
 *
 * Why: the EAM165 source FBX files have no embedded texture references —
 * they were V-Ray-exported and the diffuse maps live as separate JPEGs in
 * the kit's Textures folder. The FBX material slots come through generic.
 * We override them with the real texture so the UV mapping the asset was
 * authored against actually shows.
 *
 * Auto-sizes via bbox (same pattern as RuinAsset).
 */
type Props = {
  src: string;
  /** URL of the color / diffuse JPEG to apply to all material slots */
  colorMap: string;
  /** Optional URL of a normal map JPEG */
  normalMap?: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  targetHeight: number;
  roughness?: number;
  metalness?: number;
};

export function FbxAsset({
  src,
  colorMap,
  normalMap,
  position,
  rotation = [0, 0, 0],
  targetHeight,
  roughness = 0.7,
  metalness = 0.3,
}: Props) {
  const fbx = useFBX(src);
  // useTexture accepts a single URL and returns a Texture; or an array → tuple
  const color = useTexture(colorMap) as Texture;
  const normal = useTexture(normalMap ?? colorMap) as Texture;

  // sRGB encoding for the color map so it renders at correct gamma
  useLayoutEffect(() => {
    color.colorSpace = SRGBColorSpace;
    color.needsUpdate = true;
  }, [color]);

  const innerRef = useRef<Group>(null);
  const [computedScale, setComputedScale] = useState(1);
  const [computedOffset, setComputedOffset] = useState<[number, number, number]>([
    0, 0, 0,
  ]);

  // Clone the FBX hierarchy and force every mesh onto a single
  // MeshStandardMaterial wired to our textures.
  const cloned = useMemo(() => {
    const c = fbx.clone(true);
    const mat = new MeshStandardMaterial({
      map: color,
      normalMap: normalMap ? normal : null,
      roughness,
      metalness,
    });
    c.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh) {
        const m = o as Mesh;
        m.material = mat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    return c;
  }, [fbx, color, normal, normalMap, roughness, metalness]);

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
