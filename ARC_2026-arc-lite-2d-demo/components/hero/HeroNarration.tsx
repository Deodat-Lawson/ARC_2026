"use client";

import { useEffect, useState } from "react";
import {
  getMissionTime,
  getNarration,
  LOOP_SECONDS,
  NarrationTone,
} from "./missionTimeline";

/**
 * Cinematic "what's happening" subtitle. Reads the current narration beat
 * from the mission timeline and renders it as a large, animated subtitle
 * with a smaller contextual line beneath.
 *
 * Re-keys on text change so React re-mounts the inner span, triggering the
 * fade-up animation cleanly for each new beat.
 */
type Props = {
  /** Tighter sizing if shown inside the FPV HUD (smaller area) */
  compact?: boolean;
};

const TONE_COLOR: Record<NarrationTone, string> = {
  neutral: "#e8eaed",
  alert: "#ffd95d",
  success: "#5dffb4",
  command: "#ff7a40",
};

export function HeroNarration({ compact = false }: Props) {
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT(getMissionTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const loopT = t % LOOP_SECONDS;
  const beat = getNarration(loopT);
  const tone = beat.tone ?? "neutral";
  const color = TONE_COLOR[tone];

  return (
    <div
      className="flex flex-col items-center text-center font-mono"
      // key on text so the animation re-fires for each beat
      key={beat.text}
    >
      <div
        className={`arc-narration-rise tracking-[0.18em] uppercase ${
          compact ? "text-sm md:text-base" : "text-base md:text-xl"
        }`}
        style={{ color }}
      >
        {beat.text}
      </div>
      {beat.sub && (
        <div
          className={`arc-narration-rise mt-1 tracking-[0.18em] text-arc-muted ${
            compact ? "text-[10px]" : "text-[11px] md:text-xs"
          }`}
          style={{ animationDelay: "120ms" }}
        >
          {beat.sub}
        </div>
      )}
    </div>
  );
}
