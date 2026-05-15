"use client";

import { useInView } from "@/lib/useInView";

const STEPS = [
  {
    label: "Detect",
    title: "Wake automatically when disaster hits",
    body:
      "After an earthquake, network blackout, and road disruption, ARC starts without operator input. UAVs and Balloon relays build the first scan layer and surface early life-signal evidence.",
    meta: "15-30 min · first survivor located",
  },
  {
    label: "Coordinate",
    title: "Assign each unmanned asset to the right task",
    body:
      "Gemma 4 weighs distance, vital signs, blocked roads, energy reserve, and payload constraints, then continuously re-tasks UAVs, UGVs, and Balloon relays.",
    meta: "24 h · city-wide first scan",
  },
  {
    label: "Rescue",
    title: "Guide rescue teams to the highest-value targets",
    body:
      "ARC prioritizes high-survival-probability targets, restores temporary communications, and hands coordinates, routes, and risk levels to human rescue teams.",
    meta: "72 h · priority rescue window",
  },
] as const;

export function RescueFlowSection() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.12 });

  return (
    <section className="arc-home-deck arc-home-deck--flow border-t border-white/5 px-6 py-20 md:px-10 md:py-28">
      <div
        ref={ref}
        className={`mx-auto max-w-7xl transition-[opacity,transform] duration-700 ease-out ${
          inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
      >
        <div className="mb-10 max-w-3xl">
          <div className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-accent">
            <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" />
            Rescue logic
          </div>
          <h2 className="text-3xl font-medium leading-[1.1] tracking-tight text-arc-fg md:text-5xl">
            From disaster to rescue in three steps.
          </h2>
          <p className="mt-5 max-w-2xl text-base text-arc-muted md:text-lg">
            ARC is not just more drones. It turns post-disaster response into a closed loop:
            detect life signals, coordinate heterogeneous assets, then guide human rescuers
            to the places where they can save the most lives.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <article
              key={step.label}
              className="group relative overflow-hidden rounded-md border border-white/10 bg-[#0e1014] p-5 transition-[border-color,box-shadow] duration-200 hover:border-arc-accent/35 hover:shadow-[0_20px_60px_-18px_rgba(93,255,180,0.16)]"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-arc-accent/55 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              />
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em]">
                <span className="text-arc-muted">Step · {String(index + 1).padStart(2, "0")}</span>
                <span className="text-arc-accent">{step.label}</span>
              </div>
              <h3 className="mt-5 text-xl font-medium tracking-tight text-arc-fg">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-arc-muted">{step.body}</p>
              <div className="mt-6 border-t border-white/5 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-arc-accent/75">
                {step.meta}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-5 rounded-md border border-arc-accent/25 bg-arc-accent/5 px-5 py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-arc-muted">
          <span className="text-arc-accent">Result model</span>
          <span className="mx-2 text-white/20">/</span>
          200 km² full-city scan · 1,500-2,500 rescued in 72h · ~1,900 net additional lives
        </div>
      </div>
    </section>
  );
}
