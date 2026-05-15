"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useReducedMotion } from "@/lib/useReducedMotion";
import {
  applyWaypointLerp,
  ASSET_WAYPOINTS,
  CAMERA_KEYS,
  getLoopTime,
  getSearchOffset,
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
 *   POV       — recompute the selected asset's pose from waypoint + search
 *               offset + hover bob (the same primitives DroneSwarm/DogTeam
 *               use to write their visible position). Self-contained, no
 *               dependency on ASSET_POSITIONS.
 *
 * Why self-contained: the useLayoutEffect that snaps the camera on POV
 * switch runs *before* the next animation frame. ASSET_POSITIONS is only
 * written inside DroneSwarm/DogTeam's useFrame, so on the very first
 * useLayoutEffect call (initial mount, or after some kinds of remount /
 * Suspense replay), the refs still hold their default (0,0,0) and the
 * camera would end up at world origin — "ground level." Recomputing
 * directly from the waypoint table eliminates the race entirely; the
 * camera lands exactly where the drone body will be on the very next
 * useFrame, regardless of useFrame order.
 *
 * Why useLayoutEffect on povTarget: the previous code split FoV updates into
 * a useEffect (deferred) and pose updates into useFrame (next animation
 * frame). Between React commit and the next animation frame the browser
 * could paint one frame at the OLD camera pose with the NEW visibility
 * state — visible as a "rendering glitch" right after a POV switch. The
 * layout effect now snaps both pose AND FoV synchronously after commit but
 * before paint, so the first visible frame already reflects the new POV.
 */
export function CameraRig() {
  const { camera, gl, invalidate, setSize, size } = useThree();
  const reducedMotion = useReducedMotion();
  const povTarget = usePovTarget();

  const posOut = useMemo(() => new Vector3(), []);
  const lookOut = useMemo(() => new Vector3(), []);
  const assetPos = useMemo(() => new Vector3(), []);
  const aheadPos = useMemo(() => new Vector3(), []);
  const noiseSeed = useRef(Math.random() * 100);

  const syncCanvasProjection = useCallback(() => {
    const host = gl.domElement.parentElement;
    const rect = host?.getBoundingClientRect() ?? gl.domElement.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width <= 0 || height <= 0) return;

    // A browser zoom was fixing POV switches because it forced this resize path.
    if (width !== size.width || height !== size.height) {
      setSize(width, height);
    }
    gl.setSize(width, height, false);

    const persp = camera as PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      persp.aspect = width / height;
      persp.updateProjectionMatrix();
    }

    invalidate();
  }, [camera, gl, invalidate, setSize, size.height, size.width]);

  // Single source of truth for "where should the camera be right now".
  // Called every frame by useFrame, AND once synchronously by the
  // useLayoutEffect below whenever povTarget changes.
  const applyCameraPose = useCallback(
    (elapsedSeconds: number) => {
      if (povTarget !== "cinematic") {
        // ----- POV mode — recompute the visible pose from primitives -----
        // Same waypoint lerp + search offset + hover bob that DroneSwarm /
        // DogTeam apply. Yaw from the look-ahead waypoint direction.
        // Independent of ASSET_POSITIONS / ASSET_YAWS, so no race with the
        // first useFrame after POV switch.
        const t = getLoopTime();
        const waypoints = ASSET_WAYPOINTS[povTarget];

        applyWaypointLerp(assetPos, waypoints, t);
        const [sx, sy, sz] = getSearchOffset(povTarget, t);
        assetPos.x += sx;
        assetPos.y += sy;
        assetPos.z += sz;

        // Drone hover bob (matches DroneSwarm.updateDrone). Dogs are
        // grounded — skip.
        const isDrone =
          povTarget === "lead" || povTarget === "perception" || povTarget === "relay";
        if (isDrone) {
          const seed = waypoints[0][0];
          assetPos.y +=
            Math.sin(t * 1.6 + seed) * 0.06 +
            Math.sin(t * 0.7 + seed * 2) * 0.035;
        }

        // Yaw from a look-ahead waypoint, same as DroneSwarm. We don't apply
        // the 14% smoothing the drone does to its own rotation — the
        // unsmoothed angle is within ~14% per frame of the smoothed one,
        // imperceptible from inside the camera.
        applyWaypointLerp(
          aheadPos,
          waypoints,
          Math.min(t + 0.4, LOOP_SECONDS - 0.01),
        );
        const dirX = aheadPos.x - assetPos.x;
        const dirZ = aheadPos.z - assetPos.z;
        const yaw =
          dirX * dirX + dirZ * dirZ > 0.0001 ? Math.atan2(dirX, dirZ) : Math.PI;

        const cfg = POV_OFFSETS[povTarget];
        const ex = cfg.eye[0];
        const ey = cfg.eye[1];
        const ez = cfg.eye[2];
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);

        // Rotate local eye offset by yaw (Y-axis only).
        const worldX = assetPos.x + ex * cosY + ez * sinY;
        let worldY = assetPos.y + ey;
        const worldZ = assetPos.z + (-ex * sinY + ez * cosY);

        // FPV camera vibration on top of the body's hover bob.
        const bob = Math.abs(Math.sin(elapsedSeconds * cfg.bobHz * Math.PI)) * cfg.bobAmp;
        worldY += bob;

        camera.position.set(worldX, worldY, worldZ);

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

        // Subtle handheld noise on lookAt.
        lookOut.x += Math.sin(elapsedSeconds * 1.7 + noiseSeed.current) * 0.05;
        lookOut.y += Math.cos(elapsedSeconds * 1.3 + noiseSeed.current) * 0.04;

        // Idle scan — reproject lookAt around camera with a slow yaw/pitch
        // sweep so the operator reads as actively surveying instead of
        // staring at one point. Preserves distance to lookAt so the focal
        // depth (and any DoF feel) doesn't pump.
        const dxL = lookOut.x - worldX;
        const dyL = lookOut.y - worldY;
        const dzL = lookOut.z - worldZ;
        const radius = Math.sqrt(dxL * dxL + dyL * dyL + dzL * dzL);
        if (radius > 1e-4) {
          const baseYaw = Math.atan2(dxL, dzL);
          const basePitch = Math.asin(Math.max(-1, Math.min(1, dyL / radius)));
          const TAU = Math.PI * 2;
          const scanYaw =
            Math.sin(elapsedSeconds * cfg.scanYawHz * TAU + noiseSeed.current) *
            cfg.scanYawAmp;
          const scanPitch =
            Math.sin(
              elapsedSeconds * cfg.scanPitchHz * TAU + noiseSeed.current * 1.3,
            ) * cfg.scanPitchAmp;
          const newYaw = baseYaw + scanYaw;
          const newPitch = basePitch + scanPitch;
          const cosP = Math.cos(newPitch);
          lookOut.set(
            worldX + radius * Math.sin(newYaw) * cosP,
            worldY + radius * Math.sin(newPitch),
            worldZ + radius * Math.cos(newYaw) * cosP,
          );
        }

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

      const aftershock = Math.sin(elapsedSeconds * 11 + noiseSeed.current) * 0.018;
      posOut.y += aftershock;
      lookOut.x += Math.sin(elapsedSeconds * 0.7) * 0.05;
      lookOut.y += Math.cos(elapsedSeconds * 0.5) * 0.04;

      camera.position.copy(posOut);
      camera.lookAt(lookOut);
    },
    [povTarget, reducedMotion, camera, posOut, lookOut, assetPos, aheadPos],
  );

  // ----- Sync camera pose + FoV synchronously on POV switch -----
  // Runs after React commit but before the browser paints, so the first
  // frame visible after a POV change already shows the new camera state.
  // Without this, you'd get one frame of:
  //   • new visibility (selected drone hidden)
  //   • old camera transform (still at previous POV / cinematic pose)
  //   • old FoV (cinematic 38° even when entering a 75° drone POV)
  // — which reads as a glitch.
  useLayoutEffect(() => {
    syncCanvasProjection();

    const persp = camera as PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      const targetFov =
        povTarget === "cinematic" ? CINEMATIC_FOV : POV_OFFSETS[povTarget].fov;
      persp.fov = targetFov;
      persp.updateProjectionMatrix();
    }
    const elapsed =
      typeof performance !== "undefined" ? performance.now() / 1000 : 0;
    applyCameraPose(elapsed);

    let raf = 0;
    if (typeof requestAnimationFrame !== "undefined") {
      raf = requestAnimationFrame(() => {
        syncCanvasProjection();
        applyCameraPose(performance.now() / 1000);
      });
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [povTarget, applyCameraPose, camera, syncCanvasProjection]);

  useFrame((state) => {
    applyCameraPose(state.clock.elapsedTime);
  });

  return null;
}
