"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import { Group } from "three";
import { getLoopTime, LOOP_SECONDS, SURVIVORS, Survivor } from "./missionTimeline";

/**
 * World-anchored detection brackets — one per survivor.
 *
 * Each survivor's bracket goes through three visual states:
 *
 *   1. before identifyAtT       — hidden
 *   2. identifyAtT → rescuedAtT — yellow "Scanning · N%" with prob ramping up
 *   3. rescuedAtT → loop end    — green "LOCK · N%" (ground-confirmed)
 *
 * Two brackets co-exist because the mission rescues two people.
 */
export function DetectionHUD() {
  return (
    <group>
      {SURVIVORS.map((s) => (
        <SurvivorBracket key={s.id} data={s} />
      ))}
    </group>
  );
}

function SurvivorBracket({ data }: { data: Survivor }) {
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

    if (t >= data.identifyAtT && t < data.rescuedAtT) {
      // SCANNING — fade in + probability ramps
      opacity = Math.min(1, (t - data.identifyAtT) / 0.5);
      const ramp = Math.min(
        1,
        (t - data.identifyAtT) / (data.rescuedAtT - data.identifyAtT - 0.5),
      );
      probability = Math.round(ramp * data.probability);
    } else if (t >= data.rescuedAtT && t < LOOP_SECONDS - 1.5) {
      // LOCKED — held green during RESCUE and REPORT
      opacity = 1;
      probability = data.probability;
      locked = true;
    } else if (t >= LOOP_SECONDS - 1.5 && t < LOOP_SECONDS - 0.5) {
      // Fade out at end of loop
      opacity = (LOOP_SECONDS - 0.5 - t) / 1.0;
      probability = data.probability;
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
      position={[data.position[0], data.position[1] + 0.6, data.position[2]]}
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
          <Marker
            id={data.id}
            probability={state.probability}
            locked={state.locked}
          />
        </Html>
      )}
    </group>
  );
}

function Marker({
  id,
  probability,
  locked,
}: {
  id: string;
  probability: number;
  locked: boolean;
}) {
  const color = locked ? "#5dffb4" : "#ffd95d";
  return (
    <div className="relative flex flex-col items-center gap-1 font-mono">
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
        <path d="M8 26 V8 H26" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        <path d="M88 26 V8 H70" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        <path d="M8 70 V88 H26" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        <path d="M88 70 V88 H70" stroke={color} strokeWidth="2" fill="none" strokeLinecap="square" />
        <circle
          cx="48"
          cy="48"
          r={locked ? 10 : 7}
          fill="none"
          stroke={color}
          strokeWidth="1"
          opacity={locked ? 1 : 0.7}
        />
        <line x1="48" y1="40" x2="48" y2="56" stroke={color} strokeWidth="1" />
        <line x1="40" y1="48" x2="56" y2="48" stroke={color} strokeWidth="1" />
      </svg>
      <div
        className="flex items-center gap-1.5 rounded-sm bg-arc-bg/85 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em]"
        style={{ color }}
      >
        <span>{id}</span>
        <span className="text-arc-muted">·</span>
        <span>
          {locked ? "LOCK" : "SCAN"} {probability}%
        </span>
      </div>
    </div>
  );
}
