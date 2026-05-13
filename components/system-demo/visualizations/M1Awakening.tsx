"use client";

import { useEffect, useState } from "react";

/**
 * Module 01 — Auto-activation. Shows a "operator console" wake sequence:
 * idle sensor traces, a seismic spike, alert cascade, cluster transitions
 * to AIRBORNE state.
 */
export function M1Awakening() {
  const [phase, setPhase] = useState<"idle" | "alert" | "wake" | "airborne">(
    "idle",
  );

  useEffect(() => {
    const seq = [
      { phase: "idle" as const, ms: 1600 },
      { phase: "alert" as const, ms: 1400 },
      { phase: "wake" as const, ms: 1800 },
      { phase: "airborne" as const, ms: 3200 },
    ];
    let i = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      setPhase(seq[i].phase);
      const wait = seq[i].ms;
      i = (i + 1) % seq.length;
      setTimeout(tick, wait);
    };
    tick();
    return () => {
      stopped = true;
    };
  }, []);

  const statusColor =
    phase === "idle"
      ? "text-arc-muted"
      : phase === "alert"
        ? "text-arc-danger"
        : "text-arc-accent";
  const statusLabel =
    phase === "idle"
      ? "MONITORING"
      : phase === "alert"
        ? "ALERT · SEISMIC"
        : phase === "wake"
          ? "WAKING CLUSTER"
          : "AIRBORNE · 6/6";

  return (
    <div className="relative flex h-full w-full flex-col font-mono text-[10px] text-arc-fg/80">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 uppercase tracking-[0.2em]">
        <span className="text-arc-muted">arc · monitor</span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block size-1.5 rounded-full ${
              phase === "idle"
                ? "bg-arc-muted"
                : phase === "alert"
                  ? "bg-arc-danger animate-pulse"
                  : "bg-arc-accent"
            }`}
          />
          <span className={statusColor}>{statusLabel}</span>
        </span>
      </div>

      {/* Sensor lanes */}
      <div className="grid flex-1 grid-rows-3 divide-y divide-white/5">
        <SensorLane label="SEIS-01" spike={phase !== "idle"} hue="#5dffb4" />
        <SensorLane
          label="ACOU-02"
          spike={phase === "alert" || phase === "wake"}
          hue="#ffd95d"
          phaseOffset={0.4}
        />
        <SensorLane
          label="RF-LINK"
          spike={phase === "wake" || phase === "airborne"}
          hue="#5d9bff"
          phaseOffset={0.8}
        />
      </div>

      {/* Bottom log */}
      <div className="border-t border-white/5 px-4 py-2 leading-relaxed">
        <LogLine show={phase !== "idle"} color="text-arc-danger">
          ▲ T+0.0s · seismic threshold breached · magnitude 6.8 estimated
        </LogLine>
        <LogLine
          show={phase === "wake" || phase === "airborne"}
          color="text-arc-fg"
        >
          ⟳ T+8.4s · cluster self-check passed · 6 nodes nominal
        </LogLine>
        <LogLine show={phase === "airborne"} color="text-arc-accent">
          ✓ T+27.0s · airborne · digital twin: building
        </LogLine>
      </div>
    </div>
  );
}

function SensorLane({
  label,
  spike,
  hue,
  phaseOffset = 0,
}: {
  label: string;
  spike: boolean;
  hue: string;
  phaseOffset?: number;
}) {
  return (
    <div className="relative flex items-center px-4">
      <span className="z-10 w-14 shrink-0 text-arc-muted">{label}</span>
      <svg
        viewBox="0 0 320 40"
        preserveAspectRatio="none"
        className="h-10 flex-1"
      >
        <defs>
          <linearGradient id={`g-${label}`} x1="0" x2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="0" />
            <stop offset="50%" stopColor={hue} stopOpacity="0.6" />
            <stop offset="100%" stopColor={hue} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1="0"
          y1="20"
          x2="320"
          y2="20"
          stroke="#222"
          strokeDasharray="2 4"
        />
        <path
          d={generateWavePath(spike, phaseOffset)}
          stroke={hue}
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
    </div>
  );
}

function generateWavePath(spike: boolean, phaseOffset: number) {
  const pts: string[] = [];
  for (let x = 0; x <= 320; x += 4) {
    const t = (x / 320 + phaseOffset) * Math.PI * 4;
    let y = 20 + Math.sin(t) * 1.5 + Math.sin(t * 2.3) * 0.6;
    // Drop a big spike near the center when alert
    if (spike) {
      const d = Math.abs(x - 180);
      if (d < 36) y += (1 - d / 36) * 15 * (x < 180 ? -1 : 1);
    }
    pts.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(2)}`);
  }
  return pts.join(" ");
}

function LogLine({
  show,
  color,
  children,
}: {
  show: boolean;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`transition-opacity duration-500 ${color} ${
        show ? "opacity-100" : "opacity-0"
      }`}
    >
      {children}
    </div>
  );
}
