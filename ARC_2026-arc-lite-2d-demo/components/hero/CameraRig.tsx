"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useReducedMotion } from "@/lib/useReducedMotion";
import {
  applyWaypointLerp,
  ASSET_WAYPOINTS,
  CAMERA_KEYS,
  getLoopTime,
  LOOP_SECONDS,
  PHASES,
  smootherstep,
} from "./missionTimeline";
import {
  POV_LOOK_OVERRIDES,
  POV_OFFSETS,
  usePovTarget,
} from "./missionStore";

const CINEMATIC_FOV = 38;

/**
 * Two camera modes:
 *
 *   CINEMATIC — interpolate between phase keyframes (38° FoV).
 *   POV       — attach to a selected asset, computing its position and
 *               heading DIRECTLY from waypoints (not via ASSET_POSITIONS).
 *
 * Why self-contained POV: ASSET_POSITIONS is mutated by DroneSwarm/DogTeam in
 * their own useFrame callbacks. When the user enters FPV (which resets the
 * mission clock), the camera would otherwise see ASSET_POSITIONS still
 * holding the previous mission's values for one frame. By computing the
 * asset position locally from the waypoint table, the POV camera is fresh
 * the instant the user clicks — no one-frame flicker, no useFrame ordering
 * dependency.
 */
export function CameraRig() {
  const { camera } = useThree();
  const reducedMotion = useReducedMotion();
  const povTarget = usePovTarget();

  const posOut = useMemo(() => new Vector3(), []);
  const lookOut = useMemo(() => new Vector3(), []);
  const assetPos = useMemo(() => new Vector3(), []);
  const aheadPos = useMemo(() => new Vector3(), []);
  const noiseSeed = useRef(Math.random() * 100);

  // FoV management in an effect so it runs deterministically in the commit
  // phase (running this in the render body broke under React 18 concurrent).
  useEffect(() => {
    const persp = camera as PerspectiveCamera;
    if (!persp.isPerspectiveCamera) return;
    const targetFov =
      povTarget === "cinematic" ? CINEMATIC_FOV : POV_OFFSETS[povTarget].fov;
    persp.fov = targetFov;
    persp.updateProjectionMatrix();
  }, [povTarget, camera]);

  useFrame((state) => {
    if (povTarget !== "cinematic") {
      // ----- POV mode (self-contained, no ASSET_POSITIONS dependency) -----
      const t = getLoopTime();
      const waypoints = ASSET_WAYPOINTS[povTarget];

      // Asset position and heading computed directly from waypoints.
      applyWaypointLerp(assetPos, waypoints, t);
      applyWaypointLerp(aheadPos, waypoints, Math.min(t + 0.4, LOOP_SECONDS - 0.01));

      const dirX = aheadPos.x - assetPos.x;
      const dirZ = aheadPos.z - assetPos.z;
      // Use computed yaw if there's motion; otherwise face south (-Z toward
      // the disaster zone) so the FPV camera always shows the scene.
      const yaw =
        dirX * dirX + dirZ * dirZ > 0.0001
          ? Math.atan2(dirX, dirZ)
          : Math.PI;

      const cfg = POV_OFFSETS[povTarget];
      const ex = cfg.eye[0];
      const ey = cfg.eye[1];
      const ez = cfg.eye[2];
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);

      // Rotate local eye offset by yaw (Y-axis only)
      const worldX = assetPos.x + ex * cosY + ez * sinY;
      let worldY = assetPos.y + ey;
      const worldZ = assetPos.z + (-ex * sinY + ez * cosY);

      // Subtle motion bob (gait for dogs, vibration for drones)
      const tt = state.clock.elapsedTime;
      const bob = Math.abs(Math.sin(tt * cfg.bobHz * Math.PI)) * cfg.bobAmp;
      worldY += bob;

      camera.position.set(worldX, worldY, worldZ);

      // Look direction
      const override = POV_LOOK_OVERRIDES[povTarget];
      if (override && t >= override.fromT) {
        lookOut.set(override.lookAt[0], override.lookAt[1], override.lookAt[2]);
      } else {
        const fwdX = sinY;
        const fwdZ = cosY;
        const ahead = cfg.lookAhead;
        lookOut.set(
          worldX + fwdX * ahead,
          worldY + cfg.tilt * ahead,
          worldZ + fwdZ * ahead,
        );
      }

      // Subtle handheld noise on lookAt
      lookOut.x += Math.sin(tt * 1.7 + noiseSeed.current) * 0.05;
      lookOut.y += Math.cos(tt * 1.3 + noiseSeed.current) * 0.04;

      camera.lookAt(lookOut);
      return;
    }

    // ----- CINEMATIC mode -----
    if (reducedMotion) {
      const k = CAMERA_KEYS[0];
      camera.position.set(k.pos[0], k.pos[1], k.pos[2]);
      camera.lookAt(k.look[0], k.look[1], k.look[2]);
      return;
    }

    const t = getLoopTime();
    for (let i = 0; i < PHASES.length; i++) {
      const start = PHASES[i].t;
      const end = i === PHASES.length - 1 ? LOOP_SECONDS : PHASES[i + 1].t;
      if (t >= start && t < end) {
        // Final phase: hold on last keyframe (matches asset behavior — they
        // hold at RESCUE position during REPORT instead of looping back).
        if (i === PHASES.length - 1) {
          const k = CAMERA_KEYS[i];
          posOut.set(k.pos[0], k.pos[1], k.pos[2]);
          lookOut.set(k.look[0], k.look[1], k.look[2]);
          break;
        }
        const segT = smootherstep((t - start) / (end - start));
        const a = CAMERA_KEYS[i];
        const b = CAMERA_KEYS[i + 1];
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

    const aftershock =
      Math.sin(state.clock.elapsedTime * 11 + noiseSeed.current) * 0.018;
    posOut.y += aftershock;
    const tt = state.clock.elapsedTime;
    lookOut.x += Math.sin(tt * 0.7) * 0.05;
    lookOut.y += Math.cos(tt * 0.5) * 0.04;

    camera.position.copy(posOut);
    camera.lookAt(lookOut);
  });

  return null;
}
