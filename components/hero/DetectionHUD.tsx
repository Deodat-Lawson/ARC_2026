"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import { Group } from "three";

/**
 * The hero's "moment" — at ~t=10s into the 12s loop, a HUD bracket locks onto
 * a survivor position under the rubble. Probability ticks 0 → 87% over 2s,
 * then fades out before the loop seam.
 *
 * The survivor mesh itself is intentionally invisible — it's an anchor point.
 * In the baked GLB you'd place a low-poly silhouette here that just peeks
 * through the rubble. For now a `<group>` is enough.
 */

const LOOP_DURATION = 12;
const LOCK_START = 9.0; // bracket appears
const LOCK_FULL = 10.5; // probability reaches 87
const LOCK_FADE = 11.5; // overlay starts fading
const TARGET_PROBABILITY = 87;

export function DetectionHUD() {
  const anchor = useRef<Group>(null);
  const [state, setState] = useState({ visible: false, probability: 0, opacity: 0 });

  useFrame((rs) => {
    const t = rs.clock.elapsedTime % LOOP_DURATION;

    let opacity = 0;
    let probability = 0;

    if (t >= LOCK_START && t < LOCK_FADE) {
      // Fade-in over 0.4s
      opacity = Math.min(1, (t - LOCK_START) / 0.4);
      // Probability ramps linearly to target
      const ramp = Math.min(1, (t - LOCK_START) / (LOCK_FULL - LOCK_START));
      probability = Math.round(ramp * TARGET_PROBABILITY);
    } else if (t >= LOCK_FADE) {
      // Fade-out over 0.5s
      opacity = Math.max(0, 1 - (t - LOCK_FADE) / 0.5);
      probability = TARGET_PROBABILITY;
    }

    const visible = opacity > 0.01;
    if (
      visible !== state.visible ||
      probability !== state.probability ||
      Math.abs(opacity - state.opacity) > 0.02
    ) {
      setState({ visible, probability, opacity });
    }
  });

  return (
    <group ref={anchor} position={[-3.5, 0.4, -14]}>
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
          <DetectionMarker probability={state.probability} />
        </Html>
      )}
    </group>
  );
}

function DetectionMarker({ probability }: { probability: number }) {
  return (
    <div className="relative flex flex-col items-center gap-1 font-display">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        {/* Targeting brackets — four L shapes */}
        <path
          d="M6 22 V6 H22"
          stroke="#5dffb4"
          strokeWidth="2"
          fill="none"
          strokeLinecap="square"
        />
        <path
          d="M78 22 V6 H62"
          stroke="#5dffb4"
          strokeWidth="2"
          fill="none"
          strokeLinecap="square"
        />
        <path
          d="M6 62 V78 H22"
          stroke="#5dffb4"
          strokeWidth="2"
          fill="none"
          strokeLinecap="square"
        />
        <path
          d="M78 62 V78 H62"
          stroke="#5dffb4"
          strokeWidth="2"
          fill="none"
          strokeLinecap="square"
        />
        {/* Center cross */}
        <line x1="42" y1="36" x2="42" y2="48" stroke="#5dffb4" strokeWidth="1" />
        <line x1="36" y1="42" x2="48" y2="42" stroke="#5dffb4" strokeWidth="1" />
      </svg>
      <div className="rounded-sm bg-arc-bg/85 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-arc-accent">
        Life signal · {probability}%
      </div>
    </div>
  );
}
