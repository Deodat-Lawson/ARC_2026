"use client";

import { useEffect, useState } from "react";
import { useInView } from "@/lib/useInView";

type Phase = {
  t: string;
  label: string;
  detail: string;
};

const PHASES: Phase[] = [
  { t: "T+0s", label: "Trigger", detail: "Seismic + RF blackout detected" },
  { t: "T+30s", label: "Lift-off", detail: "Cluster airborne, self-check passed" },
  { t: "T+90s", label: "Twin online", detail: "Panoramic digital twin streamed" },
  { t: "T+6m", label: "Triage", detail: "Survivor priority queue locked" },
  { t: "T+72h", label: "Golden window", detail: "Mission sustained on shared power" },
];

export function MissionSection() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.15 });
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => {
      setActive((p) => (p + 1) % PHASES.length);
    }, 1800);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <section
      id="mission"
      className="arc-home-deck arc-home-deck--mission border-t border-white/5 px-6 py-24 md:px-10 md:py-32"
    >
      <div
        ref={ref}
        className={`mx-auto grid max-w-7xl gap-10 transition-[opacity,transform] duration-700 ease-out md:grid-cols-2 md:gap-16 ${
          inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
      >
        {/* Left — prose */}
        <div className="flex flex-col justify-center">
          <div className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-accent">
            <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" />
            Mission directive
          </div>
          <h2 className="text-3xl font-medium leading-[1.1] tracking-tight text-arc-fg md:text-5xl">
            Win back the golden window.
          </h2>
          <p className="mt-6 max-w-xl text-base text-arc-muted md:text-lg">
            Survival after a major earthquake collapses on a steep curve. ARC
            exists to flatten that curve — to reach victims faster than human
            crews can mobilise, and to keep working when the grid, the cell
            towers, and the roads are gone.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              "72-hour autonomous operation without operator command",
              "Heterogeneous air + ground assets re-tasked per second",
              "Triage decisions explainable, auditable, and signed",
            ].map((b) => (
              <li
                key={b}
                className="flex items-start gap-3 text-sm text-arc-fg/85 md:text-base"
              >
                <span
                  aria-hidden
                  className="mt-[0.55em] inline-block size-1 shrink-0 rounded-full bg-arc-muted"
                />
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-10 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-muted">
            <span>Mission</span>
            <span className="text-arc-fg">ARC-001</span>
            <span aria-hidden className="inline-block h-px w-12 bg-white/10" />
          </div>
        </div>

        {/* Right — Mission brief HUD */}
        <div>
          <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-white/10 bg-[#0e1014] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
            <div className="relative flex h-full w-full flex-col font-mono text-[10px] text-arc-fg/80">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 uppercase tracking-[0.2em]">
                <span className="text-arc-muted">arc · mission brief</span>
                <span className="flex items-center gap-2 text-arc-accent">
                  <span
                    aria-hidden
                    className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]"
                  />
                  ACTIVE
                </span>
              </div>

              {/* Body */}
              <div className="grid flex-1 grid-rows-[auto_1fr_auto] gap-3 px-4 py-3">
                {/* Objective */}
                <div>
                  <div className="text-arc-muted uppercase tracking-[0.18em]">
                    Objective
                  </div>
                  <div className="mt-1 text-sm font-medium leading-snug tracking-tight text-arc-fg">
                    Locate, triage, and signal survivors trapped in the
                    collapse footprint before the survival window closes.
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <StatCell label="Golden window" value="72" unit="hrs" />
                  <StatCell label="Response" value="30" unit="sec" />
                  <StatCell label="Cluster" value="6" unit="nodes" />
                  <StatCell label="Coverage" value="2.4" unit="km²" />
                  <StatCell label="Survival Δ" value="+38" unit="%" accent />
                  <StatCell label="Power share" value="LIVE" unit="" />
                </div>

                {/* Timeline */}
                <div>
                  <div className="mb-2 flex items-center justify-between uppercase tracking-[0.18em]">
                    <span className="text-arc-muted">Phase timeline</span>
                    <span className="text-arc-fg/60">
                      {PHASES[active].t} · {PHASES[active].label}
                    </span>
                  </div>
                  <div className="relative h-px w-full bg-white/10">
                    <div
                      className="absolute top-0 h-px bg-arc-accent shadow-[0_0_6px_rgba(93,255,180,0.7)] transition-[width] duration-700 ease-out"
                      style={{
                        width: `${((active + 1) / PHASES.length) * 100}%`,
                      }}
                    />
                    {PHASES.map((p, i) => (
                      <span
                        key={p.t}
                        className={`absolute -top-[3px] inline-block size-[7px] -translate-x-1/2 rounded-full border transition-all duration-300 ${
                          i <= active
                            ? "border-arc-accent bg-arc-accent shadow-[0_0_6px_rgba(93,255,180,0.7)]"
                            : "border-white/20 bg-arc-bg"
                        }`}
                        style={{
                          left: `${(i / (PHASES.length - 1)) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1 text-[9px] uppercase tracking-[0.15em]">
                    {PHASES.map((p, i) => (
                      <div
                        key={p.t}
                        className={`transition-colors duration-300 ${
                          i === active ? "text-arc-accent" : "text-arc-muted"
                        }`}
                      >
                        {p.t}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-arc-fg/70">
                    <span className="text-arc-muted">›</span> {PHASES[active].detail}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 uppercase tracking-[0.2em] text-arc-muted">
                <span>auth · ops/12</span>
                <span>signed · gemma 4</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCell({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-sm border border-white/5 bg-black/30 px-2 py-2">
      <div className="text-[9px] uppercase tracking-[0.15em] text-arc-muted">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`text-lg font-medium leading-none tabular-nums ${
            accent ? "text-arc-accent" : "text-arc-fg"
          }`}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[9px] uppercase tracking-[0.15em] text-arc-muted">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
