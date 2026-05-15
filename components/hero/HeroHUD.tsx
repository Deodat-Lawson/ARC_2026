"use client";

import { useEffect, useState } from "react";
import {
  getMissionTime,
  getNarration,
  LOOP_SECONDS,
} from "./missionTimeline";
import {
  ALL_ASSETS,
  ASSET_META,
  AssetId,
  setPovTargetViaUrl,
  usePovTarget,
} from "./missionStore";
import { HeroNarration } from "./HeroNarration";

/**
 * Cinematic-mode operator HUD. Hides itself when the user is in FPV (PovHUD
 * takes over).
 *
 * Layout (minimal — keep the focus on the 3D scene):
 *   • Frame: corner brackets, REC dot
 *   • TR:    "switch POV" banner + 5 clickable asset cards
 *   • BC:    cinematic narration + mission clock
 */
export function HeroHUD() {
  const povTarget = usePovTarget();
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

  if (povTarget !== "cinematic") return null;

  const loopT = t % LOOP_SECONDS;
  const narration = getNarration(loopT);
  const focused = new Set(narration.focus ?? []);

  return (
    <div className="pointer-events-none absolute inset-0 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-fg/70">
      <CornerBrackets />

      {/* TR: clear "switch POV" CTA + 5 clickable asset cards */}
      <div className="pointer-events-auto absolute right-6 top-20 flex w-[280px] flex-col gap-2 md:right-10 md:top-24">
        <PovCta />
        <div className="flex flex-col gap-2">
          {ALL_ASSETS.map((id) => (
            <AssetPanel key={id} id={id} t={t} active={focused.has(id)} />
          ))}
        </div>
      </div>

      {/* BC: cinematic narration above the mission clock */}
      <div className="absolute bottom-32 left-1/2 max-w-[60%] -translate-x-1/2 md:bottom-40">
        <HeroNarration />
      </div>
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 md:bottom-24">
        <MissionClock t={t} />
      </div>
    </div>
  );
}

// ============================================================================

function AssetPanel({ id, t, active }: { id: AssetId; t: number; active: boolean }) {
  const meta = ASSET_META[id];
  const isDrone = meta.kind === "drone";
  const seed = id.charCodeAt(0) * 0.13;
  const alt = isDrone ? 9 + Math.sin(t * 0.4 + seed) * 1.4 : 0;
  const vel = isDrone
    ? 7.4 + Math.sin(t * 0.6 + seed * 1.3) * 0.6
    : 1.6 + Math.sin(t * 0.6 + seed * 1.3) * 0.3;
  const battery = (isDrone ? 78 : 88) + Math.sin(t * 0.08 + seed) * 0.6;

  return (
    <button
      type="button"
      onClick={() => setPovTargetViaUrl(id)}
      aria-label={`Enter ${meta.label} point of view`}
      className={`group relative w-full overflow-hidden rounded-sm border p-2 text-left backdrop-blur-sm transition-all duration-150 hover:-translate-x-0.5 hover:border-arc-accent/70 hover:bg-arc-bg/85 hover:shadow-[0_0_0_1px_rgba(93,255,180,0.35),0_0_22px_-4px_rgba(93,255,180,0.5)] ${
        active
          ? "border-arc-accent/80 bg-arc-bg/85 shadow-[0_0_0_1px_rgba(93,255,180,0.35),0_0_18px_-4px_rgba(93,255,180,0.45)]"
          : "border-white/10 bg-arc-bg/65"
      }`}
    >
      {/* Hover sweep highlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(90deg, rgba(93,255,180,0) 0%, rgba(93,255,180,0.08) 60%, rgba(93,255,180,0.18) 100%)",
        }}
      />
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1.5 text-arc-fg">
          <span
            aria-hidden
            className={`inline-block size-1.5 rounded-full ${isDrone ? "bg-arc-accent" : "bg-[#5d9bff]"}`}
          />
          {meta.label}
        </span>
        <span className="text-[9px] text-arc-muted">{meta.role}</span>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-x-2 text-[10px]">
        <span className="flex justify-between">
          <span className="text-arc-muted">ALT</span>
          <span className="text-arc-fg">{isDrone ? `${alt.toFixed(1)}` : "GND"}</span>
        </span>
        <span className="flex justify-between">
          <span className="text-arc-muted">VEL</span>
          <span className="text-arc-fg">{vel.toFixed(1)}</span>
        </span>
        <span className="flex justify-between">
          <span className="text-arc-muted">PWR</span>
          <span className="text-arc-accent">{battery.toFixed(0)}%</span>
        </span>
      </div>
    </button>
  );
}

function EyeIcon({ size = 9 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
      <path
        d="M6 2.5C3.2 2.5 1 6 1 6s2.2 3.5 5 3.5S11 6 11 6 8.8 2.5 6 2.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="6" r="1.4" fill="currentColor" />
    </svg>
  );
}

function PovCta() {
  return (
    <div className="arc-pov-cta-big relative overflow-hidden rounded-md border-2 border-arc-accent bg-arc-accent px-4 py-3.5 text-arc-bg shadow-[0_0_24px_-2px_rgba(93,255,180,0.6)]">
      {/* Light sweep across the surface */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 arc-pov-sweep"
        style={{
          background:
            "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0) 100%)",
        }}
      />
      <div className="relative flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-arc-bg/70 bg-arc-bg/10">
          <EyeIcon size={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-[10px] font-medium tracking-[0.24em] text-arc-bg/70">
            INTERACTIVE
          </span>
          <span className="text-[15px] font-bold tracking-[0.06em] text-arc-bg">
            Click to switch POV
          </span>
        </div>
        <span aria-hidden className="arc-pov-arrow text-2xl font-bold text-arc-bg">
          ›
        </span>
      </div>
      <div className="relative mt-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.18em] text-arc-bg/80">
        <span aria-hidden className="arc-pov-down">↓</span>
        <span>Tap any unit below</span>
      </div>
    </div>
  );
}

function CornerBrackets() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {[
        { x1: 2, y1: 8, x2: 2, y2: 2, x3: 8, y3: 2 },
        { x1: 92, y1: 2, x2: 98, y2: 2, x3: 98, y3: 8 },
        { x1: 2, y1: 92, x2: 2, y2: 98, x3: 8, y3: 98 },
        { x1: 92, y1: 98, x2: 98, y2: 98, x3: 98, y3: 92 },
      ].map((c, i) => (
        <polyline
          key={i}
          points={`${c.x1},${c.y1} ${c.x2},${c.y2} ${c.x3},${c.y3}`}
          fill="none"
          stroke="#5dffb4"
          strokeWidth="0.15"
          opacity="0.55"
        />
      ))}
    </svg>
  );
}

function MissionClock({ t }: { t: number }) {
  const tt = (t * 10) | 0;
  const totalSec = (tt / 10) | 0;
  const mm = String((totalSec / 60) | 0).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const ds = String(tt % 10);
  return (
    <div className="flex items-center gap-4 rounded-sm border border-white/10 bg-arc-bg/70 px-4 py-1.5 backdrop-blur-sm">
      <span className="flex items-center gap-2">
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-arc-danger arc-rec-pulse" />
        REC
      </span>
      <span className="text-arc-fg">
        T+{mm}:{ss}.{ds}
      </span>
      <span className="hidden text-arc-muted md:inline">
        sector 14 · loop · 12.0s
      </span>
    </div>
  );
}

