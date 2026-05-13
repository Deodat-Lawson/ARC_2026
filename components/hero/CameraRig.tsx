"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CatmullRomCurve3, Vector3 } from "three";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * Autonomous camera path. 12-second seamless loop along a CatmullRomCurve3.
 *
 * The plan calls for Theatre.js eventually so a designer can keyframe this in
 * Studio. Until then this hand-tuned curve gets the dolly + survey feel close
 * enough to iterate on lighting and particles. The curve is closed (last
 * point ≈ first) so the loop doesn't pop.
 *
 * Tiny noise on the camera's Y and rotation gives the post-quake aftershock
 * feel without overdoing it.
 */
const LOOP_DURATION = 12;

const PATH_POINTS = [
  new Vector3(0, 4, 22),
  new Vector3(-1.2, 4.4, 16),
  new Vector3(-2.0, 5.0, 8),
  new Vector3(-1.0, 5.6, 0),
  new Vector3(1.6, 5.2, -6),
  new Vector3(2.0, 4.8, -12),
  new Vector3(0.6, 4.4, -8),
  new Vector3(-0.6, 4.2, 4),
  new Vector3(0, 4, 22),
];

const LOOK_POINTS = [
  new Vector3(0, 4, 0),
  new Vector3(-2, 3.5, -6),
  new Vector3(-4, 3, -14),
  new Vector3(-2, 2.8, -20),
  new Vector3(2, 2.5, -22),
  new Vector3(4, 2.5, -18),
  new Vector3(2, 3, -10),
  new Vector3(0, 3.5, -4),
  new Vector3(0, 4, 0),
];

export function CameraRig() {
  const { camera } = useThree();
  const reducedMotion = useReducedMotion();

  const pathCurve = useMemo(
    () => new CatmullRomCurve3(PATH_POINTS, true, "catmullrom", 0.5),
    [],
  );
  const lookCurve = useMemo(
    () => new CatmullRomCurve3(LOOK_POINTS, true, "catmullrom", 0.5),
    [],
  );

  const tmpPos = useRef(new Vector3());
  const tmpLook = useRef(new Vector3());

  useFrame((state) => {
    if (reducedMotion) {
      // Freeze on the opening frame
      camera.position.copy(PATH_POINTS[0]);
      camera.lookAt(LOOK_POINTS[0]);
      return;
    }

    const t = (state.clock.elapsedTime % LOOP_DURATION) / LOOP_DURATION;

    pathCurve.getPointAt(t, tmpPos.current);
    lookCurve.getPointAt(t, tmpLook.current);

    // Aftershock — tiny high-frequency noise
    const shake = Math.sin(state.clock.elapsedTime * 11) * 0.015;
    tmpPos.current.y += shake;

    camera.position.copy(tmpPos.current);
    camera.lookAt(tmpLook.current);
  });

  return null;
}
