"use client";

import { useEffect, useState } from "react";

/**
 * Module 03 — Multi-sensor perception. Three stacked feeds:
 *   1. thermal/visual blob with target lock
 *   2. acoustic waveform with a faint repeating "heartbeat" pulse
 *   3. survival-probability dial spinning up to 87%
 *
 * This is the visualization that maps most directly to the hero's HUD lock
 * moment — the operator console view of what the drone just saw.
 */
export function M3Perception() {
  const [probability, setProbability] = useState(0);

  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const target = 87;
    const loop = (ts: number) => {
      if (start === null) start = ts;
      const t = (ts - start) / 1000;
      // 0 → 87 in ~2s, hold, then reset every 6s
      const cycle = t % 6;
      let p = 0;
      if (cycle < 2) p = (cycle / 2) * target;
      else if (cycle < 5.4) p = target;
      else p = target * (1 - (cycle - 5.4) / 0.6);
      setProbability(Math.max(0, Math.min(target, p)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative grid h-full w-full grid-rows-[auto_1fr_1fr_auto] font-mono text-[10px] text-arc-fg/80">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 uppercase tracking-[0.2em]">
        <span className="text-arc-muted">node 03 · t-01</span>
        <span className="flex items-center gap-2 text-arc-accent">
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]"
          />
          LIFE SIGNAL · LOCKED
        </span>
      </div>

      {/* Thermal feed */}
      <div className="relative overflow-hidden border-b border-white/5">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 60% 60%, rgba(255,90,60,0.5) 0%, rgba(255,160,40,0.25) 25%, rgba(40,30,40,0.0) 55%), #0a0c10",
          }}
        />
        <ScanLines />
        {/* Target brackets */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 60"
          preserveAspectRatio="none"
        >
          <g stroke="#5dffb4" strokeWidth="0.6" fill="none">
            <path d="M 52 30 L 52 26 L 56 26" />
            <path d="M 68 30 L 68 26 L 64 26" />
            <path d="M 52 44 L 52 48 L 56 48" />
            <path d="M 68 44 L 68 48 L 64 48" />
            <line x1="60" y1="35" x2="60" y2="39" />
            <line x1="58" y1="37" x2="62" y2="37" />
          </g>
        </svg>
        <div className="absolute left-2 top-2 text-arc-muted">THERMAL · 8x</div>
        <div className="absolute bottom-2 right-2 text-arc-muted">
          37.2°C · 71% rH
        </div>
      </div>

      {/* Acoustic */}
      <div className="relative border-b border-white/5 px-3 py-2">
        <div className="mb-1 flex justify-between text-arc-muted">
          <span>ACOUSTIC · 0.5–30Hz</span>
          <span>Δ vs baseline · 4.2σ</span>
        </div>
        <svg
          viewBox="0 0 320 60"
          preserveAspectRatio="none"
          className="h-12 w-full"
        >
          <line
            x1="0"
            y1="30"
            x2="320"
            y2="30"
            stroke="#1f2227"
            strokeDasharray="2 4"
          />
          <path d={generateHeartbeatPath()} stroke="#5dffb4" strokeWidth="1.1" fill="none" />
        </svg>
      </div>

      {/* Probability dial + bottom log */}
      <div className="flex items-center gap-4 px-4 py-3">
        <ProbabilityDial value={probability} />
        <div className="flex-1 leading-relaxed">
          <div className="text-arc-fg">
            Survival window estimate ·{" "}
            <span className="text-arc-accent">14.2 h</span>
          </div>
          <div className="text-arc-muted">
            T-int 6°C · weather: rain · entrapment: medium
          </div>
          <div className="mt-1 text-arc-muted">
            Routing to planner · priority 0.94
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanLines() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 mix-blend-overlay opacity-40"
      style={{
        background:
          "repeating-linear-gradient(180deg, rgba(255,255,255,0) 0 2px, rgba(255,255,255,0.04) 2px 3px)",
      }}
    />
  );
}

function generateHeartbeatPath() {
  // Composite: low baseline noise + repeating heartbeat spike pattern
  const pts: string[] = [];
  for (let x = 0; x <= 320; x += 2) {
    let y = 30 + Math.sin(x * 0.22) * 1.4 + Math.sin(x * 0.61) * 0.7;
    // Heartbeat spike every ~60px
    const m = x % 64;
    if (m > 4 && m < 12) {
      y -= Math.sin(((m - 4) / 8) * Math.PI) * 14;
    } else if (m > 13 && m < 19) {
      y += Math.sin(((m - 13) / 6) * Math.PI) * 6;
    }
    pts.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(2)}`);
  }
  return pts.join(" ");
}

function ProbabilityDial({ value }: { value: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  return (
    <div className="relative size-[72px] shrink-0">
      <svg viewBox="0 0 72 72" className="size-full -rotate-90">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="#1f2227" strokeWidth="4" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="#5dffb4"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 120ms linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-base text-arc-fg">
          {Math.round(value)}
          <span className="text-[10px] text-arc-muted">%</span>
        </span>
        <span className="text-[9px] uppercase tracking-[0.18em] text-arc-muted">
          SURV
        </span>
      </div>
    </div>
  );
}
