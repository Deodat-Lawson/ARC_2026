"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import {
  currentPhaseName,
  getLoopTime,
  getMissionTime,
  LOOP_SECONDS,
} from "./missionTimeline";
import { usePovTarget } from "./missionStore";

// Module-level snapshot — mutated every frame by the in-canvas bridge,
// read every animation frame by the DOM overlay. No React notifications
// per frame (would re-render the entire tree).
type CameraSnapshot = {
  px: number;
  py: number;
  pz: number;
  lx: number;
  ly: number;
  lz: number;
  fov: number;
};

export const SNAPSHOT: CameraSnapshot = {
  px: 0,
  py: 0,
  pz: 0,
  lx: 0,
  ly: 0,
  lz: 0,
  fov: 0,
};

// Local cache for vectors so we don't allocate per frame.
const _fwd = new Vector3();
const _look = new Vector3();

/**
 * Lives inside the <Canvas>. Writes the camera's current pose into the
 * module-level SNAPSHOT each frame so the DOM overlay can read it without
 * forcing React re-renders of the 3D scene.
 *
 * Must be the LAST useFrame so it observes whatever CameraRig wrote this
 * frame — render order inside Suspense matches mount order, so place this
 * after <CameraRig />.
 */
export function CameraDebugBridge() {
  const { camera } = useThree();
  useFrame(() => {
    SNAPSHOT.px = camera.position.x;
    SNAPSHOT.py = camera.position.y;
    SNAPSHOT.pz = camera.position.z;
    // Reconstruct lookAt as position + forward * 1 (drei/THREE doesn't
    // store the lookAt target, only the resulting rotation).
    camera.getWorldDirection(_fwd);
    _look.copy(camera.position).add(_fwd);
    SNAPSHOT.lx = _look.x;
    SNAPSHOT.ly = _look.y;
    SNAPSHOT.lz = _look.z;
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      SNAPSHOT.fov = (camera as PerspectiveCamera).fov;
    }
  });
  return null;
}

/**
 * DOM overlay that reads SNAPSHOT each animation frame and renders it as a
 * monospace HUD. Hidden in production builds. Toggle with the `D` key.
 */
export function CameraDebugOverlay() {
  const povTarget = usePovTarget();
  const [visible, setVisible] = useState(true);
  const [, force] = useState(0);
  const lastDraw = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = (now: number) => {
      // Cap to ~30Hz so the DOM doesn't thrash.
      if (now - lastDraw.current >= 33) {
        lastDraw.current = now;
        force((n) => (n + 1) & 0xffff);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  const mt = getMissionTime();
  const lt = getLoopTime();
  const phase = currentPhaseName(lt);

  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-50 rounded-sm border border-arc-accent/40 bg-black/70 px-2.5 py-1.5 font-mono text-[10px] leading-tight text-arc-accent backdrop-blur-sm"
      style={{ minWidth: 240 }}
    >
      <div className="mb-0.5 flex items-center justify-between gap-3 text-arc-fg">
        <span>CAM · {povTarget}</span>
        <span className="text-arc-muted">[D] hide</span>
      </div>
      <Row label="pos" x={SNAPSHOT.px} y={SNAPSHOT.py} z={SNAPSHOT.pz} />
      <Row label="look" x={SNAPSHOT.lx} y={SNAPSHOT.ly} z={SNAPSHOT.lz} />
      <div className="mt-0.5 flex justify-between text-arc-muted">
        <span>fov {SNAPSHOT.fov.toFixed(1)}°</span>
        <span>
          t {lt.toFixed(2)}/{LOOP_SECONDS}s
        </span>
        <span>mt {mt.toFixed(1)}s</span>
      </div>
      <div className="text-arc-fg">phase · {phase}</div>
    </div>
  );
}

function Row({
  label,
  x,
  y,
  z,
}: {
  label: string;
  x: number;
  y: number;
  z: number;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-arc-muted">{label}</span>
      <span>
        <Num n={x} />
        <span className="mx-1 text-arc-muted">·</span>
        <Num n={y} />
        <span className="mx-1 text-arc-muted">·</span>
        <Num n={z} />
      </span>
    </div>
  );
}

function Num({ n }: { n: number }) {
  const s = n.toFixed(2);
  // Pad so columns align without monospace fighting decimals.
  return <span style={{ display: "inline-block", minWidth: 48, textAlign: "right" }}>{s}</span>;
}
