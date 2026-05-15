"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/docs/PageShell";
import { useInView } from "@/lib/useInView";

// ─── Live clock ───────────────────────────────────────────────────────────────

function LiveClock() {
  const [ts, setTs] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setTs(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ` +
          `UTC${d.getTimezoneOffset() <= 0 ? "+" : "-"}${Math.abs(d.getTimezoneOffset()) / 60}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="tabular-nums">{ts || "—"}</span>;
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.06 });
  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-700 ease-out ${
        inView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function Kicker({ children }: { children: string }) {
  return (
    <div className="mb-5 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-accent">
      <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" />
      {children}
    </div>
  );
}

type StatusLevel = "nominal" | "minor" | "offline";

function StatusDot({ level }: { level: StatusLevel }) {
  const cls =
    level === "nominal"
      ? "bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.6)]"
      : level === "minor"
        ? "bg-arc-warning shadow-[0_0_6px_2px_rgba(255,217,93,0.5)]"
        : "bg-arc-danger shadow-[0_0_6px_2px_rgba(255,93,108,0.5)]";
  return <span className={`inline-block size-2 rounded-full ${cls}`} />;
}

function StatusTag({ level }: { level: StatusLevel }) {
  const cls =
    level === "nominal"
      ? "text-arc-accent"
      : level === "minor"
        ? "text-arc-warning"
        : "text-arc-danger";
  const label = level === "nominal" ? "Nominal" : level === "minor" ? "Minor Issue" : "Offline";
  return (
    <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] ${cls}`}>
      <StatusDot level={level} />
      {label}
    </span>
  );
}

function BarMeter({ value, max }: { value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  const color = pct === 100 ? "bg-arc-accent" : pct >= 85 ? "bg-arc-warning" : "bg-arc-danger";
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-1 flex-1 rounded-full bg-white/8">
        <div
          className={`h-full rounded-full shadow-[0_0_6px_rgba(93,255,180,0.4)] transition-[width] duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-arc-muted">
        {value}/{max}
      </span>
    </div>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const FLEET = [
  { id: "UAV", icon: "drone", total: 60, online: 59, label: "Units · 59 online" },
  { id: "UGV", icon: "ground", total: 32, online: 31, label: "Units · 31 standby" },
  { id: "Balloon", icon: "balloon", total: 80, online: 79, label: "Platforms · 79 active" },
  { id: "Generator", icon: "power", total: 8, online: 8, label: "Units · all ready" },
  { id: "Battery Packs", icon: "battery", total: 121, online: 118, label: "Packs · 118 charged" },
  { id: "Network Nodes", icon: "mesh", total: 24, online: 23, label: "Nodes · 23 online" },
] as const;

type WarehouseStatus = { id: string; name: string; sector: string; status: StatusLevel; uav: [number, number]; ugv: [number, number]; balloon: [number, number]; generator: [number, number] };
const WAREHOUSES: WarehouseStatus[] = [
  { id: "NW", name: "Sector Alpha", sector: "Northwest", status: "nominal", uav: [15, 15], ugv: [8, 8], balloon: [20, 20], generator: [2, 2] },
  { id: "NE", name: "Sector Beta", sector: "Northeast", status: "minor", uav: [15, 15], ugv: [8, 8], balloon: [19, 20], generator: [2, 2] },
  { id: "SW", name: "Sector Gamma", sector: "Southwest", status: "nominal", uav: [14, 15], ugv: [8, 8], balloon: [20, 20], generator: [2, 2] },
  { id: "SE", name: "Sector Delta", sector: "Southeast", status: "minor", uav: [15, 15], ugv: [7, 8], balloon: [20, 20], generator: [2, 2] },
];

const EVENTS = [
  { time: "18:34:01", level: "info" as const, msg: "Heartbeat sync · 4/4 warehouse clusters reported nominal" },
  { time: "18:30:12", level: "warn" as const, msg: "NE-Balloon-07 scheduled maintenance window started" },
  { time: "18:25:44", level: "info" as const, msg: "SE-UGV-03 maintenance cycle completed · returned to standby" },
  { time: "18:20:00", level: "info" as const, msg: "Daily cluster self-test · 24/24 nodes passed all checks" },
  { time: "17:45:38", level: "info" as const, msg: "UAV battery rotation cycle complete · SW-UAV-12 charging" },
  { time: "16:55:19", level: "warn" as const, msg: "SW-UAV-12 battery degradation flag · swap scheduled" },
  { time: "09:00:00", level: "info" as const, msg: "System startup · full cluster initialization complete" },
];

// ─── SVG icons ────────────────────────────────────────────────────────────────

function AssetIcon({ kind }: { kind: string }) {
  const p = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "drone":
      return <svg {...p}><circle cx="4" cy="4" r="2"/><circle cx="20" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><path d="M6 6l4 4M18 6l-4 4M6 18l4-4M18 18l-4-4"/><circle cx="12" cy="12" r="2.5"/></svg>;
    case "ground":
      return <svg {...p}><rect x="4" y="9" width="16" height="7" rx="1"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/><path d="M8 9V6h8v3"/></svg>;
    case "balloon":
      return <svg {...p}><ellipse cx="12" cy="9" rx="5" ry="6"/><path d="M12 15v4M10 19h4"/><path d="M7 7.5C6 9 6 11 7 12"/><path d="M17 7.5c1 1.5 1 3.5 0 4.5"/></svg>;
    case "power":
      return <svg {...p}><rect x="3" y="7" width="18" height="12" rx="1"/><path d="M8 7V5M16 7V5"/><path d="M12 11v4M10 13h4"/></svg>;
    case "battery":
      return <svg {...p}><rect x="2" y="8" width="16" height="8" rx="1"/><path d="M18 11v2h3v-2"/><path d="M5 12h8"/></svg>;
    case "mesh":
      return <svg {...p}><circle cx="6" cy="6" r="1.8"/><circle cx="18" cy="6" r="1.8"/><circle cx="6" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/><circle cx="12" cy="12" r="1.8"/><path d="M7.6 6.8L10.5 11M16.4 6.8L13.5 11M7.6 17.2L10.5 13M16.4 17.2L13.5 13"/></svg>;
    default:
      return null;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CentralControlPage() {
  return (
    <PageShell>
      {/* ── System status bar ────────────────────────── */}
      <div className="border-b border-white/5 bg-[#0e1014] px-6 py-2.5 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-arc-accent">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.6)]" />
              Cluster status · Nominal
            </span>
            <span className="hidden text-arc-muted md:inline">·</span>
            <span className="hidden text-arc-muted md:inline">Alert level · Green</span>
          </div>
          <div className="text-arc-muted">
            <LiveClock />
          </div>
        </div>
      </div>

      {/* ── Hero ─────────────────────────────────────── */}
      <section className="px-6 py-16 md:px-10 md:py-24">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Kicker>A.R.C. · Central Control Platform</Kicker>
            <h1 className="max-w-3xl text-4xl font-medium leading-[1.05] tracking-tight md:text-6xl">
              Real-time cluster
              <br />
              <span className="text-arc-accent">operations overview.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base text-arc-muted md:text-lg">
              Live inventory, readiness, and mobilization state across all four warehouse clusters.
              Zero operator input required — the swarm monitors itself.
            </p>
          </Reveal>

          {/* Top KPIs */}
          <Reveal className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: "Total UAV", v: "60", sub: "59 online · 1 charging" },
              { l: "Total UGV", v: "32", sub: "31 standby · 1 maintenance" },
              { l: "Total Balloon", v: "80", sub: "79 active · 1 maintenance" },
              { l: "Clusters online", v: "4 / 4", sub: "All warehouses nominal" },
            ].map(({ l, v, sub }) => (
              <div key={l} className="rounded-md border border-white/10 bg-[#0e1014] px-4 py-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">{l}</div>
                <div className="mt-2 text-2xl font-medium tabular-nums text-arc-accent md:text-3xl">{v}</div>
                <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted/70">{sub}</div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Fleet Inventory ──────────────────────────── */}
      <section className="border-t border-white/5 px-6 py-16 md:px-10 md:py-20">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Kicker>Panel 01 · Fleet inventory</Kicker>
            <h2 className="text-2xl font-medium tracking-tight md:text-4xl">
              Asset-class readiness.
            </h2>
          </Reveal>

          <Reveal className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FLEET.map((asset, i) => {
              const pct = Math.round((asset.online / asset.total) * 100);
              const status: StatusLevel = pct === 100 ? "nominal" : pct >= 90 ? "minor" : "offline";
              return (
                <div
                  key={asset.id}
                  className="group relative overflow-hidden rounded-md border border-white/10 bg-[#0e1014] p-4 transition-[border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-arc-accent/35 hover:shadow-[0_20px_50px_-20px_rgba(93,255,180,0.2)]"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-px left-4 right-4 h-px bg-gradient-to-r from-transparent via-arc-accent/55 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  />
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em]">
                    <span className="text-arc-muted">Node · {String(i + 1).padStart(2, "0")}</span>
                    <StatusTag level={status} />
                  </div>

                  <div className="mt-4 flex items-start gap-4">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-black/40 text-arc-accent">
                      <AssetIcon kind={asset.icon} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-xs uppercase tracking-[0.2em] text-arc-accent">
                        {asset.id}
                      </div>
                      <div className="mt-0.5 text-2xl font-medium tabular-nums text-arc-fg">
                        {asset.online}
                        <span className="ml-1 text-sm text-arc-muted">/ {asset.total}</span>
                      </div>
                      <BarMeter value={asset.online} max={asset.total} />
                    </div>
                  </div>

                  <div className="mt-4 border-t border-white/5 pt-3 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted">
                    {asset.label}
                  </div>
                </div>
              );
            })}
          </Reveal>
        </div>
      </section>

      {/* ── Warehouse Clusters ───────────────────────── */}
      <section className="border-t border-white/5 px-6 py-16 md:px-10 md:py-20">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Kicker>Panel 02 · Warehouse clusters</Kicker>
            <h2 className="text-2xl font-medium tracking-tight md:text-4xl">
              Per-cluster status.
            </h2>
          </Reveal>

          <Reveal className="mt-8 grid gap-4 md:grid-cols-2">
            {WAREHOUSES.map((w) => (
              <div
                key={w.id}
                className="overflow-hidden rounded-md border border-white/10 bg-[#0e1014]"
              >
                {/* header */}
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-muted">
                      Cluster · {w.id}
                    </div>
                    <div className="mt-1 font-medium text-arc-fg">
                      {w.name}
                      <span className="ml-2 text-sm text-arc-muted">— {w.sector}</span>
                    </div>
                  </div>
                  <StatusTag level={w.status} />
                </div>

                {/* asset grid */}
                <div className="grid grid-cols-2 divide-x divide-y divide-white/5">
                  {(
                    [
                      { label: "UAV", val: w.uav },
                      { label: "UGV", val: w.ugv },
                      { label: "Balloon", val: w.balloon },
                      { label: "Generator", val: w.generator },
                    ] as { label: string; val: [number, number] }[]
                  ).map(({ label, val: [on, tot] }) => (
                    <div key={label} className="px-4 py-3">
                      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-arc-muted">
                        {label}
                      </div>
                      <div className="mt-1 text-lg font-medium tabular-nums text-arc-fg">
                        {on}
                        <span className="text-sm text-arc-muted">/{tot}</span>
                      </div>
                      <BarMeter value={on} max={tot} />
                    </div>
                  ))}
                </div>

                {/* footer */}
                <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-arc-muted">
                  <span>Coverage · 50 km²</span>
                  <span>Sync · ok</span>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Mobilization State ───────────────────────── */}
      <section className="border-t border-white/5 px-6 py-16 md:px-10 md:py-20">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Kicker>Panel 03 · Mobilization state</Kicker>
            <h2 className="text-2xl font-medium tracking-tight md:text-4xl">
              Readiness &amp; trigger systems.
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {/* Left: state panel */}
            <Reveal>
              <div className="h-full overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em]">
                  <span className="text-arc-muted">arc · mobilization state</span>
                  <span className="flex items-center gap-1.5 text-arc-warning">
                    <span className="inline-block size-1.5 animate-pulse rounded-full bg-arc-warning shadow-[0_0_5px_1px_rgba(255,217,93,0.6)]" />
                    Standby-Plus
                  </span>
                </div>

                <div className="px-4 py-4 space-y-4">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                      Trigger sources
                    </div>
                    <ul className="mt-3 space-y-2">
                      {[
                        { label: "Seismic API monitor", status: "Connected" },
                        { label: "RF blackout detector", status: "Armed" },
                        { label: "Manual override console", status: "Armed" },
                      ].map(({ label, status }) => (
                        <li key={label} className="flex items-center justify-between text-sm">
                          <span className="text-arc-fg/80">{label}</span>
                          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-arc-accent">
                            <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_4px_rgba(93,255,180,0.6)]" />
                            {status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border-t border-white/5 pt-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                      Readiness indicators
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        { l: "Assets ready", ok: true },
                        { l: "Comms live", ok: true },
                        { l: "AI models loaded", ok: true },
                        { l: "Crew notified", ok: false },
                      ].map(({ l, ok }) => (
                        <div
                          key={l}
                          className={`flex items-center gap-2 rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] ${
                            ok
                              ? "border-arc-accent/25 bg-arc-accent/8 text-arc-accent"
                              : "border-arc-muted/20 bg-white/3 text-arc-muted"
                          }`}
                        >
                          <span
                            className={`inline-block size-1.5 rounded-full ${
                              ok ? "bg-arc-accent shadow-[0_0_4px_rgba(93,255,180,0.6)]" : "bg-arc-muted/50"
                            }`}
                          />
                          {l}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-white/5 pt-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                      Estimated time to full deployment
                    </div>
                    <div className="mt-2 text-4xl font-medium tabular-nums text-arc-fg">
                      &lt; 180 s
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted/60">
                      from trigger signal to airborne
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-arc-muted">
                  <span>uplink ▮▮▮▮▯</span>
                  <span>signed · gemma 4</span>
                </div>
              </div>
            </Reveal>

            {/* Right: event log */}
            <Reveal>
              <div className="h-full overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em]">
                  <span className="text-arc-muted">arc · system event log</span>
                  <span className="flex items-center gap-1.5 text-arc-accent">
                    <span className="inline-block size-1.5 animate-pulse rounded-full bg-arc-accent shadow-[0_0_5px_1px_rgba(93,255,180,0.6)]" />
                    Live
                  </span>
                </div>

                <ul className="divide-y divide-white/5 px-4 py-1">
                  {EVENTS.map(({ time, level, msg }) => (
                    <li key={`${time}-${msg}`} className="flex items-start gap-3 py-2.5">
                      <span className="mt-[1px] shrink-0 font-mono text-[10px] tabular-nums text-arc-muted">
                        {time}
                      </span>
                      <span
                        className={`mt-[1px] shrink-0 inline-block size-1.5 rounded-full mt-1 ${
                          level === "warn"
                            ? "bg-arc-warning shadow-[0_0_4px_rgba(255,217,93,0.5)]"
                            : "bg-arc-accent shadow-[0_0_4px_rgba(93,255,180,0.5)]"
                        }`}
                      />
                      <span className="text-sm leading-snug text-arc-fg/80">{msg}</span>
                    </li>
                  ))}
                </ul>

                <div className="border-t border-white/5 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-arc-muted">
                  Showing 7 most recent events · auto-refresh every 60 s
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Global impact summary ────────────────────── */}
      <section className="border-t border-white/5 px-6 py-16 md:px-10 md:py-20">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Kicker>Panel 04 · Mission readiness summary</Kicker>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { l: "City coverage", v: "200 km²", sub: "4 × 50 km² sectors" },
                { l: "Protected population", v: "1,000,000", sub: "M7.0 earthquake scenario" },
                { l: "Full deployment time", v: "< 3 min", sub: "From seismic trigger to airborne" },
              ].map(({ l, v, sub }) => (
                <div
                  key={l}
                  className="rounded-md border border-white/10 bg-[#0e1014] px-5 py-4"
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">{l}</div>
                  <div className="mt-2 text-2xl font-medium tabular-nums text-arc-accent md:text-3xl">{v}</div>
                  <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted/70">{sub}</div>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal className="mt-4 rounded-md border border-arc-accent/30 bg-arc-accent/5 px-6 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-accent">
                  System status
                </div>
                <p className="mt-1.5 text-base font-medium text-arc-fg">
                  All 4 warehouse clusters online ·{" "}
                  <span className="text-arc-accent">171 / 172 assets ready</span> ·
                  awaiting trigger or manual dispatch.
                </p>
              </div>
              <div className="shrink-0 font-mono text-4xl font-medium tabular-nums text-arc-accent">
                99.4%
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </PageShell>
  );
}
