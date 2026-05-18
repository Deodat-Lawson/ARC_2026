"use client";

import { ModuleSection } from "./ModuleSection";
import { M1Awakening } from "./visualizations/M1Awakening";
import { M2Planning } from "./visualizations/M2Planning";
import { M3Perception } from "./visualizations/M3Perception";
import { M4Energy } from "./visualizations/M4Energy";
import { M5Mesh } from "./visualizations/M5Mesh";

/**
 * Five scroll-driven sections demonstrating how the ARC operator console
 * looks during a real mission. Each section pairs prose (left) with a
 * synthetic product-UI panel (right) that animates as it enters the viewport.
 *
 * The panels are intentionally SVG/CSS — they should feel like product
 * screenshots, not 3D toys.
 */
export function SystemDemo() {
  return (
    <div id="system" className="arc-home-deck arc-home-deck--system relative">
      <SectionDivider label="How it works" />

      <ModuleSection
        index="01"
        title="When the grid goes dark, the swarm wakes up."
        kicker="Module 01 · Automatic activation"
        body="The instant power and comms drop, low-level seismic and acoustic thresholds wake every node in the cluster. ARC self-checks, lifts off, and starts building a live digital twin of the disaster zone — no operator command required."
        bullets={[
          "Passive wake on sensor-threshold or emergency-frequency signals",
          "30-second cold-start per wave; full-city deploy under 3 minutes",
          "First panoramic situational map streamed within 90 seconds",
        ]}
        visualization={<M1Awakening />}
      />

      <ModuleSection
        index="02"
        title="Plan globally. Prioritise mathematically."
        kicker="Module 02 · Task allocation"
        body="Gemma 4 fuses terrain damage, distance, energy budget, and payload constraints into a single utility score. The cluster then re-orders missions in real time — refusing dead-ends, avoiding deadlock, maximising the total lives saved per joule."
        bullets={[
          "Multi-objective priority score per target",
          "Heterogeneous routing across air and ground assets",
          "Re-plans on every new piece of evidence",
        ]}
        visualization={<M2Planning />}
        align="right"
      />

      <ModuleSection
        index="03"
        title="Hear a heartbeat through rubble."
        kicker="Module 03 · Multi-sensor perception"
        body="Thermal, visual, olfactory, sub-acoustic sensors and UWB radar waves fuse into a single survival-probability estimate. ARC weighs continuously weather, temperature and humidity, non-natural signal strength and ventilation to predict each victim's survival window — and feeds it straight back into the planner."
        bullets={[
          "Sub-audible vibration detection through structural debris",
          "Survival-probability estimate updated each pass",
          "Most-critical-first ordering enforced at the planner",
        ]}
        visualization={<M3Perception />}
      />

      <ModuleSection
        index="04"
        title="Share the battery. Stretch the mission."
        kicker="Module 04 · Energy allocation"
        body="The cluster treats power as a shared resource. Redundant nodes sleep. Ground UGVs roll forward as mobile charging stations for the most-utilised air units. The mission stays in the air longer than any single drone could."
        bullets={[
          "Idle-node sleep to extend the cluster's combined endurance",
          "UGV-as-mobile-charger forward deployment",
          "Energy-aware re-planning when reserves drop",
        ]}
        visualization={<M4Energy />}
        align="right"
      />

      <ModuleSection
        index="05"
        title="Become the network you replaced."
        kicker="Module 05 · Mesh & relay"
        body="Where the cell network died, ARC's high-altitude nodes hover as ad-hoc relays. Data flows from the rubble to command. Trapped civilians get emergency signal back. The cluster is the last connective tissue in the disaster zone."
        bullets={[
          "Self-healing ad-hoc mesh between airborne nodes",
          "Structured Gemma 4 situation reports back to command",
          "Emergency signal broadcast for trapped civilians",
          "Temporary local area network provides support to lost disaster victims",
        ]}
        visualization={<M5Mesh />}
      />
    </div>
  );
}

export function LiveReplayCta() {
  return (
    <section className="flex min-h-[58vh] flex-col justify-center border-t border-white/5 px-6 py-16 md:min-h-[52vh] md:px-10 md:py-20">
      <div className="mx-auto flex w-full max-w-7xl translate-y-4 flex-col items-start gap-10 md:translate-y-8 md:flex-row md:items-end md:justify-between lg:translate-y-10">
        <div className="max-w-2xl">
          <div className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-accent">
            <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" />
            Live replay
          </div>
          <h2 className="text-3xl font-medium leading-[1.1] tracking-tight text-arc-fg md:text-5xl">
            Watch the cluster run a real mission.
          </h2>
          <p className="mt-6 text-base text-arc-muted md:text-lg">
            A scripted post-quake scenario, played frame-by-frame. Every
            timestep the planner re-prioritises victims, agents pick new
            tasks, and Gemma 4 reports back to the operator.
          </p>
        </div>
        <a
          href="/simulation"
          className="group inline-flex h-12 shrink-0 items-center gap-3 rounded-sm bg-arc-accent px-6 text-sm font-medium tracking-wide text-arc-bg transition-[opacity,gap] hover:opacity-90 hover:gap-4"
        >
          Open the live simulation
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
        </a>
      </div>
    </section>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="border-t border-white/5 px-6 py-20 md:px-10">
      <div className="mx-auto flex max-w-7xl items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.32em] text-arc-muted">
          {label}
        </span>
        <span className="font-mono text-xs uppercase tracking-[0.32em] text-arc-muted">
          5 modules · 6-node mission slice
        </span>
      </div>
    </div>
  );
}
