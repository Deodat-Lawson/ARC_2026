"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import { Group } from "three";
import { getLoopTime, SURVIVOR_POS } from "./missionTimeline";

/**
 * 3D-anchored detection bracket that locks onto the survivor position during
 * the DETECT / CONFIRM mission phases.
 *
 * Timing within the 12s mission loop:
 *   t<6     hidden
 *   t=6.0   bracket appears
 *   t=6→8   probability ramps 0 → 87 (DETECT phase)
 *   t=8→10  bracket holds, "lock confirmed" subtitle (CONFIRM)
 *   t=10→11 fades out
 *   t>11    hidden
 */
const TARGET_PROBABILITY = 87;

export function DetectionHUD() {
  const anchor = useRef<Group>(null);
  const [state, setState] = useState({
    visible: false,
    probability: 0,
    opacity: 0,
    locked: false,
  });

  useFrame(() => {
    const t = getLoopTime();

    let opacity = 0;
    let probability = 0;
    let locked = false;

    if (t >= 6 && t < 8) {
      // DETECT — fade in + probability ramps
      opacity = Math.min(1, (t - 6) / 0.5);
      probability = Math.round(Math.min(1, (t - 6) / 1.8) * TARGET_PROBABILITY);
    } else if (t >= 8 && t < 10) {
      // CONFIRM — full opacity, full probability, locked
      opacity = 1;
      probability = TARGET_PROBABILITY;
      locked = true;
    } else if (t >= 10 && t < 11) {
      // Beginning of RELAY — fade out
      opacity = 1 - (t - 10);
      probability = TARGET_PROBABILITY;
      locked = true;
    }

    const visible = opacity > 0.01;
    if (
      visible !== state.visible ||
      probability !== state.probability ||
      locked !== state.locked ||
      Math.abs(opacity - state.opacity) > 0.02
    ) {
      setState({ visible, probability, opacity, locked });
    }
  });

  return (
    <group
      ref={anchor}
      position={[SURVIVOR_POS[0], SURVIVOR_POS[1], SURVIVOR_POS[2]]}
    >
      {state.visible && (
        <Html
          center
          distanceFactor={10}
          zIndexRange={[10, 0]}
          style={{
            opacity: state.opacity,
            pointerEvents: "none",
            transition: "opacity 80ms linear",
          }}
        >
          <DetectionMarker probability={state.probability} locked={state.locked} />
        </Html>
      )}
    </group>
  );
}

function DetectionMarker({
  probability,
  locked,
}: {
  probability: number;
  locked: boolean;
}) {
  const color = locked ? "#5dffb4" : "#ffd95d";
  return (
    <div className="relative flex flex-col items-center gap-1 font-mono">
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
        {/* Targeting brackets */}
        <path d="M8 26 V8 H26" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        <path d="M88 26 V8 H70" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        <path d="M8 70 V88 H26" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        <path d="M88 70 V88 H70" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        {/* Center pulse ring */}
        <circle
          cx="48"
          cy="48"
          r={locked ? 10 : 7}
          fill="none"
          stroke={color}
          strokeWidth="1"
          opacity={locked ? 1 : 0.7}
        />
        {/* Crosshair */}
        <line x1="48" y1="40" x2="48" y2="56" stroke={color} strokeWidth="1" />
        <line x1="40" y1="48" x2="56" y2="48" stroke={color} strokeWidth="1" />
      </svg>
      <div
        className="rounded-sm bg-arc-bg/85 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em]"
        style={{ color }}
      >
        {locked ? `LOCK · ${probability}%` : `Scanning · ${probability}%`}
      </div>
    </div>
  );
}
