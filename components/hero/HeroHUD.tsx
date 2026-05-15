"use client";

import { useEffect, useState } from "react";
import {
  COMM_COLORS,
  COMM_EVENTS,
  currentPhaseIndex,
  getMissionTime,
  getNarration,
  LOOP_SECONDS,
  PHASES,
  SURVIVORS,
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
 * Layout:
 *   • Frame:    corner brackets, scan lines, REC dot
 *   • TL:       radar sweep
 *   • TR:       stack of 5 asset panels (3 drones + 2 dogs) — each clickable
 *               to enter FPV for that asset
 *   • MR:       comm log
 *   • BL:       mission phase + scrubber
 *   • BC:       mission clock
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
  const phaseIdx = currentPhaseIndex(loopT);
  const phaseName = PHASES[phaseIdx].name;
  const phaseStart = PHASES[phaseIdx].t;
  const phaseEnd =
    phaseIdx === PHASES.length - 1 ? LOOP_SECONDS : PHASES[phaseIdx + 1].t;
  const phaseProgress = (loopT - phaseStart) / (phaseEnd - phaseStart);
  const narration = getNarration(loopT);
  const focused = new Set(narration.focus ?? []);

  return (
    <div className="pointer-events-none absolute inset-0 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-fg/70">
      <div
        aria-hidden
        className="absolute inset-0 mix-blend-overlay opacity-60"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0) 0 2px, rgba(255,255,255,0.025) 2px 3px)",
        }}
      />

      <CornerBrackets />

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

      <div className="absolute left-6 top-20 md:left-10 md:top-24">
        <SignalFan />
      </div>

      {/* TR: cluster roster — 3 drones + 2 dogs, each clickable for FPV */}
      <div className="pointer-events-auto absolute right-6 top-20 flex flex-col gap-2 md:right-10 md:top-24">
        <div className="text-arc-muted">Cluster · 5/5</div>
        {ALL_ASSETS.map((id) => (
          <AssetPanel key={id} id={id} t={t} active={focused.has(id)} />
        ))}
        <div className="mt-1 text-[9px] text-arc-muted">
          tap any unit · enter FPV
        </div>
      </div>

      <div className="absolute right-6 top-[60%] md:right-10">
        <TargetsPanel t={t} focused={focused} />
      </div>

      <div className="absolute right-6 bottom-44 md:right-10 md:bottom-48">
        <CommLog t={t} />
        <CommLegend />
      </div>

      <div className="absolute bottom-24 left-6 md:bottom-28 md:left-10">
        <PhaseIndicator
          phaseName={phaseName}
          phaseIdx={phaseIdx}
          phaseProgress={phaseProgress}
        />
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

function CommLegend() {
  const items: [string, string][] = [
    ["telemetry", "#5dffb4"],
    ["alert", "#ffd95d"],
    ["dispatch", "#5d9bff"],
    ["command", "#ff7a40"],
  ];
  return (
    <div className="mt-1.5 flex items-center justify-between text-[9px] text-arc-muted">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block size-1 rounded-full"
            style={{ background: color }}
          />
          {label}
        </span>
      ))}
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
      className={`group w-[210px] rounded-sm border p-2 text-left backdrop-blur-sm transition hover:border-arc-accent/60 hover:bg-arc-bg/80 ${
        active
          ? "border-arc-accent/80 bg-arc-bg/85 shadow-[0_0_0_1px_rgba(93,255,180,0.35),0_0_18px_-4px_rgba(93,255,180,0.45)]"
          : "border-white/10 bg-arc-bg/65"
      }`}
    >
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
      <div className="mt-1 text-[9px] text-arc-muted opacity-0 transition group-hover:opacity-100">
        click to enter FPV ↗
      </div>
    </button>
  );
}

function TargetsPanel({ t, focused }: { t: number; focused: Set<string> }) {
  const loopT = t % LOOP_SECONDS;
  return (
    <div className="w-[260px] rounded-sm border border-white/10 bg-arc-bg/70 p-2 backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between text-arc-muted">
        <span>Targets · {SURVIVORS.length}</span>
        <span className="inline-block size-1 rounded-full bg-arc-accent" />
      </div>
      <div className="flex flex-col gap-1.5">
        {SURVIVORS.map((s) => {
          const isFocused = focused.has(s.id);
          let status: "queued" | "scanning" | "lock" = "queued";
          let prob = 0;
          if (loopT >= s.identifyAtT && loopT < s.rescuedAtT) {
            status = "scanning";
            const ramp = Math.min(
              1,
              (loopT - s.identifyAtT) / (s.rescuedAtT - s.identifyAtT - 0.5),
            );
            prob = Math.round(ramp * s.probability);
          } else if (loopT >= s.rescuedAtT) {
            status = "lock";
            prob = s.probability;
          }
          const tone =
            status === "lock"
              ? "text-arc-accent"
              : status === "scanning"
                ? "text-arc-warning"
                : "text-arc-muted";
          const dot =
            status === "lock"
              ? "bg-arc-accent"
              : status === "scanning"
                ? "bg-arc-warning animate-pulse"
                : "bg-white/20";
          return (
            <div
              key={s.id}
              className={`flex items-center gap-2 rounded-sm px-1 py-0.5 text-[10px] transition ${
                isFocused ? "bg-arc-accent/10" : ""
              }`}
            >
              <span
                aria-hidden
                className={`inline-block size-1.5 rounded-full ${dot}`}
              />
              <span className="w-10 text-arc-fg">{s.id}</span>
              <div className="relative h-1 flex-1 overflow-hidden bg-white/5">
                <div
                  className="h-full"
                  style={{
                    width: `${prob}%`,
                    background:
                      status === "lock"
                        ? "#5dffb4"
                        : status === "scanning"
                          ? "#ffd95d"
                          : "transparent",
                    transition: "width 200ms linear",
                  }}
                />
              </div>
              <span className={`w-16 text-right ${tone}`}>
                {status === "queued"
                  ? "queued"
                  : `${status.toUpperCase()} ${prob}%`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-[9px] text-arc-muted">
        D-01 → T-01 · D-02 → T-02 · priority by survival prob
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

function CommLog({ t }: { t: number }) {
  const loopT = t % LOOP_SECONDS;
  const cycle = Math.floor(t / LOOP_SECONDS);
  const entries: { time: string; log: string; color: string; age: number }[] = [];
  for (const ev of COMM_EVENTS) {
    if (loopT >= ev.t) {
      entries.push({
        time: formatT(cycle * LOOP_SECONDS + ev.t),
        log: ev.log,
        color: COMM_COLORS[ev.kind],
        age: loopT - ev.t,
      });
    }
  }
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
  const visible = entries.slice(-6);
  return (
    <div className="w-[300px] rounded-sm border border-white/10 bg-arc-bg/70 p-2 backdrop-blur-sm">
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
    <div className="w-[300px] rounded-sm border border-white/10 bg-arc-bg/70 p-2 backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-arc-muted">Mission phase</span>
        <span className="text-arc-accent">{phaseName}</span>
      </div>
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
