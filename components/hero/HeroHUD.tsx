"use client";

import { useEffect, useRef, useState } from "react";
import {
  COMM_COLORS,
  COMM_EVENTS,
  currentPhaseIndex,
  getMissionTime,
  LOOP_SECONDS,
  PHASES,
} from "./missionTimeline";

/**
 * Operator-console HUD layered between the WebGL canvas and the headline
 * marketing copy. Drives off the SAME mission timeline as the 3D scene, so
 * what you see in the HUD always matches what the drones are doing.
 *
 * Zones:
 *   • Frame:   corner brackets, scan lines, REC indicator
 *   • TL:      radar/sweep
 *   • TR:      stack of 3 drone telemetry panels (A-01 / A-02 / A-03)
 *   • MR:      comm log (newest at top, last 5 events)
 *   • BL:      mission phase indicator + timeline scrubber
 *   • BC:      mission clock (T+ live counter)
 */
export function HeroHUD() {
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
  const phaseIdx = currentPhaseIndex(loopT);
  const phaseName = PHASES[phaseIdx].name;
  const phaseStart = PHASES[phaseIdx].t;
  const phaseEnd =
    phaseIdx === PHASES.length - 1 ? LOOP_SECONDS : PHASES[phaseIdx + 1].t;
  const phaseProgress = (loopT - phaseStart) / (phaseEnd - phaseStart);

  return (
    <div className="pointer-events-none absolute inset-0 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-fg/70">
      {/* full-screen subtle scan line */}
      <div
        aria-hidden
        className="absolute inset-0 mix-blend-overlay opacity-60"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0) 0 2px, rgba(255,255,255,0.025) 2px 3px)",
        }}
      />

      <CornerBrackets />

      {/* center crosshair / reticle (faint) */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-50">
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
          <circle cx="22" cy="22" r="9" stroke="#5dffb4" strokeWidth="0.8" fill="none" />
          <line x1="22" y1="2" x2="22" y2="13" stroke="#5dffb4" strokeWidth="0.6" />
          <line x1="22" y1="31" x2="22" y2="42" stroke="#5dffb4" strokeWidth="0.6" />
          <line x1="2" y1="22" x2="13" y2="22" stroke="#5dffb4" strokeWidth="0.6" />
          <line x1="31" y1="22" x2="42" y2="22" stroke="#5dffb4" strokeWidth="0.6" />
          <circle cx="22" cy="22" r="1.4" fill="#5dffb4" />
        </svg>
      </div>

      {/* TL: signal fan */}
      <div className="absolute left-6 top-20 md:left-10 md:top-24">
        <SignalFan />
      </div>

      {/* TR: stacked drone telemetry */}
      <div className="absolute right-6 top-20 flex flex-col gap-2 md:right-10 md:top-24">
        <DronePanel id="A-01" role="LEAD · SURVEY" t={t} seed={0} battery={78} link="MESH 5/5" tone="ok" />
        <DronePanel id="A-02" role="PERCEPTION" t={t} seed={1.3} battery={64} link="MESH 5/5" tone="ok" />
        <DronePanel id="A-03" role="RELAY · ↑CMD" t={t} seed={2.6} battery={88} link="UPLINK 142kb/s" tone="ok" />
      </div>

      {/* MR: comm log */}
      <div className="absolute right-6 top-[58%] md:right-10">
        <CommLog t={t} />
      </div>

      {/* BL: mission phase + scrubber */}
      <div className="absolute bottom-24 left-6 md:bottom-28 md:left-10">
        <PhaseIndicator
          phaseName={phaseName}
          phaseIdx={phaseIdx}
          phaseProgress={phaseProgress}
        />
      </div>

      {/* BC: mission clock + REC indicator */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 md:bottom-28">
        <MissionClock t={t} />
      </div>
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

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

function DronePanel({
  id,
  role,
  t,
  seed,
  battery,
  link,
  tone,
}: {
  id: string;
  role: string;
  t: number;
  seed: number;
  battery: number;
  link: string;
  tone: "ok" | "warn";
}) {
  // Smooth telemetry wandering, seeded so each drone reads slightly different
  const alt = 9 + Math.sin(t * 0.4 + seed) * 1.5;
  const hdg = (t * 6 + seed * 60) % 360;
  const vel = 7.4 + Math.sin(t * 0.6 + seed * 1.3) * 0.6;
  const bat = battery + Math.sin(t * 0.08 + seed) * 0.6;
  return (
    <div className="min-w-[200px] rounded-sm border border-white/10 bg-arc-bg/65 p-2 backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between text-arc-muted">
        <span className="text-arc-fg">{id}</span>
        <span className="text-[9px]">{role}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        <Row label="ALT" value={`${alt.toFixed(1)}m`} />
        <Row label="HDG" value={`${hdg.toFixed(0).padStart(3, "0")}°`} />
        <Row label="VEL" value={`${vel.toFixed(1)}m/s`} />
        <Row label="PWR" value={`${bat.toFixed(0)}%`} tone={bat < 35 ? "warn" : tone} />
      </div>
      <div className="mt-1 text-[9px] text-arc-accent">{link}</div>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const tint =
    tone === "ok"
      ? "text-arc-accent"
      : tone === "warn"
        ? "text-arc-warning"
        : "text-arc-fg";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-arc-muted">{label}</span>
      <span className={tint}>{value}</span>
    </div>
  );
}

/**
 * Comm log — newest events at top, fade-out after a few seconds.
 * Reads directly from COMM_EVENTS and shows events whose time has just
 * passed in the current loop.
 */
function CommLog({ t }: { t: number }) {
  const loopT = t % LOOP_SECONDS;
  const cycle = Math.floor(t / LOOP_SECONDS);

  // Build a synthetic log: collect comm events whose `t` is ≤ current loopT
  // from this cycle, plus a few from the previous cycle for context.
  const entries: { time: string; log: string; color: string; age: number }[] = [];
  for (const ev of COMM_EVENTS) {
    if (loopT >= ev.t) {
      const elapsed = loopT - ev.t;
      entries.push({
        time: formatT(cycle * LOOP_SECONDS + ev.t),
        log: ev.log,
        color: COMM_COLORS[ev.kind],
        age: elapsed,
      });
    }
  }
  // Pull a few from previous cycle for continuity (oldest)
  if (cycle > 0) {
    for (const ev of COMM_EVENTS.slice(-3)) {
      entries.unshift({
        time: formatT((cycle - 1) * LOOP_SECONDS + ev.t),
        log: ev.log,
        color: COMM_COLORS[ev.kind],
        age: LOOP_SECONDS - ev.t + loopT,
      });
    }
  }
  const visible = entries.slice(-5);

  return (
    <div className="w-[280px] rounded-sm border border-white/10 bg-arc-bg/70 p-2 backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between text-arc-muted">
        <span>Mesh comm log</span>
        <span className="inline-block size-1 rounded-full bg-arc-accent" />
      </div>
      <div className="flex flex-col gap-1">
        {visible.length === 0 && (
          <div className="text-[10px] text-arc-muted">[ awaiting traffic ]</div>
        )}
        {visible.map((e, i) => {
          const fade = Math.max(0.3, 1 - e.age / 4);
          return (
            <div
              key={`${e.time}-${i}`}
              className="flex items-baseline gap-2 text-[10px]"
              style={{ opacity: fade }}
            >
              <span className="text-arc-muted">{e.time}</span>
              <span style={{ color: e.color }}>{e.log}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhaseIndicator({
  phaseName,
  phaseIdx,
  phaseProgress,
}: {
  phaseName: string;
  phaseIdx: number;
  phaseProgress: number;
}) {
  return (
    <div className="w-[280px] rounded-sm border border-white/10 bg-arc-bg/70 p-2 backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-arc-muted">Mission phase</span>
        <span className="text-arc-accent">{phaseName}</span>
      </div>
      {/* 6 segment scrubber */}
      <div className="flex gap-1">
        {PHASES.map((p, i) => {
          const active = i === phaseIdx;
          const past = i < phaseIdx;
          const fillW = active ? `${phaseProgress * 100}%` : past ? "100%" : "0%";
          return (
            <div key={p.name} className="relative h-1 flex-1 overflow-hidden bg-white/5">
              <div
                className="absolute inset-y-0 left-0 bg-arc-accent"
                style={{
                  width: fillW,
                  transition: active ? "none" : "width 200ms linear",
                  opacity: past ? 0.45 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[8px] text-arc-muted">
        {PHASES.map((p) => (
          <span key={p.name} className="w-[14%] text-center">
            {p.name.slice(0, 4)}
          </span>
        ))}
      </div>
    </div>
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
        <span
          aria-hidden
          className="inline-block size-1.5 rounded-full bg-arc-danger arc-rec-pulse"
        />
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

function SignalFan() {
  return (
    <div className="relative size-16">
      <svg viewBox="0 0 64 64" className="size-full">
        <circle cx="32" cy="32" r="28" fill="none" stroke="#1f2227" strokeWidth="0.6" />
        <circle cx="32" cy="32" r="20" fill="none" stroke="#1f2227" strokeWidth="0.6" />
        <circle cx="32" cy="32" r="12" fill="none" stroke="#1f2227" strokeWidth="0.6" />
        <line x1="32" y1="4" x2="32" y2="60" stroke="#1f2227" strokeWidth="0.5" />
        <line x1="4" y1="32" x2="60" y2="32" stroke="#1f2227" strokeWidth="0.5" />
      </svg>
      <div
        aria-hidden
        className="arc-radar-sweep absolute inset-0 origin-center"
        style={{
          background:
            "conic-gradient(from 0deg, rgba(93,255,180,0.55) 0deg, rgba(93,255,180,0) 60deg, rgba(93,255,180,0) 360deg)",
          maskImage: "radial-gradient(circle, black 30%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle, black 30%, transparent 70%)",
        }}
      />
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] tracking-[0.2em] text-arc-muted">
        SCAN
      </div>
    </div>
  );
}

function formatT(absT: number): string {
  const s = absT.toFixed(1);
  return `T+${s.padStart(5, "0")}s`;
}
