"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import { useReducedMotion } from "@/lib/useReducedMotion";
import {
  CAMERA_KEYS,
  getLoopTime,
  LOOP_SECONDS,
  PHASES,
  smootherstep,
} from "./missionTimeline";

/**
 * Mission-driven cinematic camera. Each of the 6 phases has a (position,
 * lookAt) keyframe; we smootherstep between adjacent keyframes within each
 * phase, wrap RELAY → APPROACH for a seamless loop.
 *
 * Adds:
 *   • Tiny per-frame jitter on Y (post-quake aftershock feel)
 *   • Subtle handheld noise on the lookAt point (organic camera)
 */
export function CameraRig() {
  const { camera } = useThree();
  const reducedMotion = useReducedMotion();

  const posOut = useMemo(() => new Vector3(), []);
  const lookOut = useMemo(() => new Vector3(), []);
  const noiseSeed = useRef(Math.random() * 100);

  useFrame((state) => {
    if (reducedMotion) {
      const k = CAMERA_KEYS[0];
      camera.position.set(k.pos[0], k.pos[1], k.pos[2]);
      camera.lookAt(k.look[0], k.look[1], k.look[2]);
      return;
    }

    const t = getLoopTime();

    // Find the segment we're in and interpolate
    for (let i = 0; i < PHASES.length; i++) {
      const start = PHASES[i].t;
      const end = i === PHASES.length - 1 ? LOOP_SECONDS : PHASES[i + 1].t;
      if (t >= start && t < end) {
        const segT = smootherstep((t - start) / (end - start));
        const a = CAMERA_KEYS[i];
        const b = CAMERA_KEYS[(i + 1) % PHASES.length];
        posOut.set(
          a.pos[0] + (b.pos[0] - a.pos[0]) * segT,
          a.pos[1] + (b.pos[1] - a.pos[1]) * segT,
          a.pos[2] + (b.pos[2] - a.pos[2]) * segT,
        );
        lookOut.set(
          a.look[0] + (b.look[0] - a.look[0]) * segT,
          a.look[1] + (b.look[1] - a.look[1]) * segT,
          a.look[2] + (b.look[2] - a.look[2]) * segT,
        );
        break;
      }
    }

    // Aftershock jitter on Y (high frequency, low amplitude)
    const aftershock = Math.sin(state.clock.elapsedTime * 11 + noiseSeed.current) * 0.018;
    posOut.y += aftershock;

    // Organic handheld noise on lookAt
    const tt = state.clock.elapsedTime;
    lookOut.x += Math.sin(tt * 0.7) * 0.05;
    lookOut.y += Math.cos(tt * 0.5) * 0.04;

    camera.position.copy(posOut);
    camera.lookAt(lookOut);
  });

  return null;
}
