"use client";

import { ReactNode } from "react";
import { PageShell } from "@/components/docs/PageShell";
import { useInView } from "@/lib/useInView";

// ─── Primitives ───────────────────────────────────────────────────────────────

function Kicker({ children }: { children: string }) {
  return (
    <div className="mb-5 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-accent">
      <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" />
      {children}
    </div>
  );
}

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.08 });
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

function StatCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-[#0e1014] px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-muted">{label}</div>
      <div
        className={`mt-2 text-2xl font-medium tabular-nums leading-none md:text-3xl ${
          accent ? "text-arc-accent" : "text-arc-fg"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-arc-muted">
          {sub}
        </div>
      )}
    </div>
  );
}

function ModelAssumptionCard({
  title,
  items,
}: {
  title: string;
  items: [string, string][];
}) {
  return (
    <div className="rounded-md border border-white/10 bg-[#0e1014] px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-accent">
        {title}
      </div>
      <dl className="mt-3 space-y-2">
        {items.map(([label, value]) => (
          <div key={label} className="grid gap-1 border-t border-white/5 pt-2 first:border-0 first:pt-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-arc-muted">
              {label}
            </dt>
            <dd className="text-sm leading-relaxed text-arc-fg/85">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HudPanel({
  kicker,
  title,
  rows,
}: {
  kicker: string;
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className="group relative overflow-hidden rounded-md border border-white/10 bg-[#0e1014] transition-[border-color,box-shadow] duration-200 hover:border-arc-accent/30 hover:shadow-[0_20px_60px_-15px_rgba(93,255,180,0.1)]">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-arc-accent/50 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em]">
        <span className="text-arc-muted">{kicker}</span>
        <span className="flex items-center gap-1.5 text-arc-accent">
          <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_4px_1px_rgba(93,255,180,0.6)]" />
          Nominal
        </span>
      </div>
      <div className="border-b border-white/5 px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] text-arc-fg/60">
        {title}
      </div>
      <dl className="px-4 py-1">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2 last:border-0"
          >
            <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted">
              {k}
            </dt>
            <dd className="text-right text-sm text-arc-fg/90">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Sec({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-t border-white/5 px-6 py-20 md:px-10 md:py-28">
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const UAV_ROWS: [string, string][] = [
  ["Model", "DJI Matrice 350 RTK"],
  ["Endurance (unloaded)", "55 min"],
  ["Mission endurance", "30 min (with payload)"],
  ["Top speed", "20 m/s · 72 km/h"],
  ["Effective radius", "~5 km"],
  ["Thermal sensor range", "300 m"],
  ["Visual sensor range", "500 m"],
  ["Max payload", "2.7 kg"],
  ["Unit price", "$13,700"],
  ["Fast-charge time", "~50 min"],
];

const UGV_ROWS: [string, string][] = [
  ["Model", "Milrem THeMIS Rescue"],
  ["Endurance (hybrid)", "~15 h"],
  ["Top speed", "20 km/h"],
  ["Effective radius", "~15 km"],
  ["Standard payload", "750 kg"],
  ["Max payload", "1,200 kg"],
  ["Unit price", "$89,000"],
  ["Rescue capacity", "~2 persons / day"],
];

const BALLOON_ROWS: [string, string][] = [
  ["Type", "Tactical Tethered Aerostat"],
  ["Airborne duration", "15–30 days (tethered)"],
  ["Operating altitude", "200–1,000 m"],
  ["Comms radius @ 800 m AGL", "~10 km"],
  ["Surveillance radius", "~5 km"],
  ["Payload capacity", "50–100 kg"],
  ["Unit price", "$16,400"],
  ["Helium refill cost", "~$70 / fill"],
];

const GENERATOR_ROWS: [string, string][] = [
  ["Rated power", "50 kW"],
  ["Fuel consumption @ 75% load", "~11 L/h"],
  ["72h total consumption", "792 L"],
  ["Diesel unit price", "~$1.10 / L"],
  ["72h fuel cost", "~$870"],
  ["Unit price", "$6,200"],
];

const SURVIVAL: [string, string, string][] = [
  ["< 24 h", "74–90%", "Post-earthquake survivor probability"],
  ["< 72 h", "20–30%", "Post-earthquake survivor probability"],
  ["< 120 h", "5–10%", "Post-earthquake survivor probability"],
  ["~72 h", "Medical ceiling", "No-water survival limit"],
];

const COMPARE: [string, string, string, string][] = [
  ["24h search area", "3.5 km²", "200 km²", "×57"],
  ["72h coverage rate", "5.25%", "100%", "×19"],
  ["First survivor located", "2–6 h", "15–30 min", "×8–12"],
  ["72h survivors located", "~500", "~8,000", "×16"],
  ["72h actual rescued", "105", "1,500–2,500", "×15–24"],
  ["Comms restoration", "24–72 h", "2–4 h", "×6–18"],
  ["Rescue rate", "1%", "20%", "×20"],
  ["Cost per life saved", "$783,000", "$4,900", "0.6%"],
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CostPage() {
  return (
    <PageShell>
      {/* ── Hero ─────────────────────────────────────── */}
      <section className="px-6 py-20 md:px-10 md:py-28">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Kicker>A.R.C. · Deployment Economics</Kicker>
            <h1 className="max-w-4xl text-4xl font-medium leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
              Four warehouses.
              <br />
              <span className="text-arc-accent">One city saved.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base text-arc-muted md:text-lg">
              A rigorous cost-of-ownership model for deploying an ARC heterogeneous rescue
              cluster across a 200 km² city of one million. From vehicle specs to per-life
              economics.
            </p>
          </Reveal>

          <Reveal className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCell label="Total investment" value="$5.8M" sub="4 warehouses · full city" />
            <StatCell label="Lives saved / disaster" value="~2,000" sub="vs 105 human-only" accent />
            <StatCell label="Cost per life saved" value="$4,900" sub="vs $783K human-only" />
            <StatCell label="Rescue rate uplift" value="×20" sub="1% → 20% rescued" accent />
          </Reveal>

          <Reveal className="mt-6 grid gap-3 md:grid-cols-3">
            <ModelAssumptionCard
              title="Scenario assumptions"
              items={[
                ["City model", "1,000,000 people, ~200 km² built area, M7.0 earthquake scenario."],
                ["Entrapment baseline", "1% trapped population assumption, yielding ~10,000 people needing search and triage."],
                ["Golden window", "0-72h survival window, with rescue value concentrated in the first 24-48h."],
              ]}
            />
            <ModelAssumptionCard
              title="Deployment model"
              items={[
                ["Warehouse layout", "4 warehouses split the city into 50 km² sectors, keeping far-edge UAV transit under ~5 km."],
                ["Per warehouse", "15 UAV, 8 UGV, 20 Balloon platforms, and 2 × 50 kW generators."],
                ["City total", "60 UAV, 32 UGV, 80 Balloon platforms, and 8 generators for full-city coverage."],
              ]}
            />
            <ModelAssumptionCard
              title="Impact calculation"
              items={[
                ["Human-only baseline", "3 heavy USAR teams + 10 light teams search ~10.5 km² and rescue ~105 people in 72h."],
                ["ARC-assisted result", "ARC completes first full-city scan in ~24h and guides rescue toward confirmed life signals."],
                ["Main KPI", "1,500-2,500 actual rescues in 72h; page uses ~2,000 midpoint and ~1,900 net additional lives."],
              ]}
            />
          </Reveal>
        </div>
      </section>

      {/* ── Fleet Architecture ───────────────────────── */}
      <Sec id="fleet">
        <Reveal>
          <Kicker>Module 01 · Fleet architecture</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            Heterogeneous asset stack.
          </h2>
          <p className="mt-4 max-w-2xl text-arc-muted">
            Three vehicle classes — air, ground, and persistent overhead — each tuned to a
            specific layer of the post-disaster mission envelope.
          </p>
        </Reveal>

        <Reveal className="mt-10 grid gap-4 md:grid-cols-3">
          <HudPanel
            kicker="arc · uav — node type 001"
            title="DJI Matrice 350 RTK"
            rows={UAV_ROWS}
          />
          <HudPanel
            kicker="arc · ugv — node type 002"
            title="Milrem THeMIS Rescue"
            rows={UGV_ROWS}
          />
          <HudPanel
            kicker="arc · balloon — node type 003"
            title="Tethered Aerostat Platform"
            rows={BALLOON_ROWS}
          />
        </Reveal>

        <Reveal className="mt-4 md:w-1/3">
          <HudPanel
            kicker="arc · power — node type 004"
            title="50 kW Diesel Generator"
            rows={GENERATOR_ROWS}
          />
        </Reveal>

        {/* Survival statistics */}
        <Reveal className="mt-8">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-arc-muted">
            Post-earthquake survival probability (source: INSARAG / NIH)
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {SURVIVAL.map(([t, v, l]) => (
              <div
                key={t}
                className="rounded-md border border-white/8 bg-[#0e1014]/60 px-4 py-3"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-arc-muted">
                  {l}
                </div>
                <div className="mt-2 text-xl font-medium text-arc-fg">{v}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted/60">
                  {t}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </Sec>

      {/* ── Deployment Configuration ─────────────────── */}
      <Sec id="deployment">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <Reveal className="flex flex-col justify-center">
            <Kicker>Module 02 · Deployment configuration</Kicker>
            <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
              Four-cluster city grid.
            </h2>
            <p className="mt-4 max-w-xl text-arc-muted">
              A single central warehouse cannot meet response-time targets for a 200 km² city.
              Distributing four clusters at 7 km spacing keeps every point within UAV range.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                "Coverage per warehouse: 50 km²",
                "Inter-warehouse spacing: ~7 km",
                "Max UAV transit to any edge: ~4 km < 5 km radius ✓",
                "Trapped population per cluster: ~2,500 persons",
              ].map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-arc-fg/80">
                  <span className="mt-[0.55em] inline-block size-1 shrink-0 rounded-full bg-arc-muted" />
                  {b}
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-md border border-white/10 bg-[#0e1014] px-4 py-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                City parameters
              </div>
              {[
                ["Population", "1,000,000"],
                ["Built area", "~200 km²"],
                ["Scenario", "M7.0 earthquake"],
                ["Entrapment rate", "~1%"],
                ["Estimated trapped", "~10,000 persons"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between border-t border-white/5 py-1.5 text-sm"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted">
                    {k}
                  </span>
                  <span className="text-arc-fg/90">{v}</span>
                </div>
              ))}
            </div>
          </Reveal>

          {/* Cluster map */}
          <Reveal>
            <div className="aspect-square w-full overflow-hidden rounded-md border border-white/10 bg-[#0e1014] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
              <div className="flex h-full w-full flex-col font-mono text-[10px] text-arc-fg/80">
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5 uppercase tracking-[0.2em]">
                  <span className="text-arc-muted">arc · deployment map</span>
                  <span className="flex items-center gap-1.5 text-arc-accent">
                    <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_5px_1px_rgba(93,255,180,0.6)]" />
                    4 clusters · online
                  </span>
                </div>

                <div className="relative grid flex-1 grid-cols-2 grid-rows-2">
                  {(
                    [
                      { q: "NW", name: "Sector Alpha" },
                      { q: "NE", name: "Sector Beta" },
                      { q: "SW", name: "Sector Gamma" },
                      { q: "SE", name: "Sector Delta" },
                    ] as const
                  ).map(({ q, name }) => (
                    <div
                      key={q}
                      className="flex items-center justify-center border border-white/5"
                    >
                      <div className="text-center">
                        <div className="mx-auto flex size-10 items-center justify-center rounded-sm border border-arc-accent/40 bg-arc-accent/10 text-arc-accent shadow-[0_0_20px_4px_rgba(93,255,180,0.12)]">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                          >
                            <circle cx="4" cy="4" r="2" />
                            <circle cx="20" cy="4" r="2" />
                            <circle cx="4" cy="20" r="2" />
                            <circle cx="20" cy="20" r="2" />
                            <path d="M6 6l4 4M18 6l-4 4M6 18l4-4M18 18l-4-4" />
                            <circle cx="12" cy="12" r="2.5" />
                          </svg>
                        </div>
                        <div className="mt-2 uppercase tracking-[0.18em] text-arc-accent">
                          {q}
                        </div>
                        <div className="mt-0.5 text-[9px] text-arc-muted">{name}</div>
                        <div className="mt-0.5 text-[9px] text-arc-accent/70">50 km²</div>
                      </div>
                    </div>
                  ))}

                  {/* cross-hair */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 m-auto h-px w-1/2 bg-arc-accent/15"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 m-auto h-1/2 w-px bg-arc-accent/15"
                  />
                </div>

                <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 uppercase tracking-[0.2em] text-arc-muted">
                  <span>city area · 200 km²</span>
                  <span>spacing · ~7 km</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </Sec>

      {/* ── Investment Breakdown ─────────────────────── */}
      <Sec id="investment">
        <Reveal>
          <Kicker>Module 03 · Investment breakdown</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            Per-warehouse to city-wide cost.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
              <div className="border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                Single warehouse · equipment bill
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    {["Asset", "Qty", "Unit price", "Subtotal"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted ${
                          i === 0 ? "text-left" : "text-right"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["UAV", "15", "$13,700", "$205,500"],
                      ["UGV", "8", "$89,000", "$712,000"],
                      ["Balloon platform", "20", "$16,400", "$328,000"],
                      ["Generator 50 kW", "2", "$6,200", "$12,400"],
                      ["Diesel reserve 2,000 L", "—", "$1.10 / L", "$2,200"],
                      ["Warehouse construction", "1", "—", "$68,500"],
                    ] as [string, string, string, string][]
                  ).map(([a, q, u, t]) => (
                    <tr key={a} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-arc-fg/90">{a}</td>
                      <td className="px-4 py-2.5 text-right text-arc-muted">{q}</td>
                      <td className="px-4 py-2.5 text-right text-arc-muted">{u}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-arc-fg">{t}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-arc-accent/25 bg-arc-accent/5">
                    <td
                      colSpan={3}
                      className="px-4 py-3 font-mono text-xs font-medium uppercase tracking-[0.18em] text-arc-accent"
                    >
                      Per-warehouse total
                    </td>
                    <td className="px-4 py-3 text-right text-xl font-medium tabular-nums text-arc-accent">
                      $1,328,600
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Reveal>

          <Reveal className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
              <div className="border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                City-wide total investment
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {(
                    [
                      ["Equipment × 4 warehouses", "$5,314,400"],
                      ["Central control system", "$274,000"],
                      ["Communications infrastructure", "$137,000"],
                      ["Installation & commissioning", "$68,500"],
                    ] as [string, string][]
                  ).map(([k, v]) => (
                    <tr key={k} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-arc-muted">{k}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-arc-fg">{v}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-arc-accent/25 bg-arc-accent/5">
                    <td className="px-4 py-3 font-mono text-xs font-medium uppercase tracking-[0.18em] text-arc-accent">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right text-xl font-medium tabular-nums text-arc-accent">
                      $5,793,900
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { l: "UAV fleet", v: "60 units" },
                { l: "UGV fleet", v: "32 units" },
                { l: "Balloon fleet", v: "80 units" },
                { l: "Generators", v: "8 units" },
              ].map(({ l, v }) => (
                <div
                  key={l}
                  className="rounded-md border border-white/10 bg-[#0e1014] px-4 py-3"
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted">
                    {l}
                  </div>
                  <div className="mt-1.5 text-xl font-medium text-arc-fg">{v}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Sec>

      {/* ── Operating Costs ──────────────────────────── */}
      <Sec id="ops">
        <Reveal>
          <Kicker>Module 04 · Operating costs</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            Annual maintenance &amp; incident economics.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
              <div className="border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                Annual operating costs (non-disaster)
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {(
                    [
                      ["UAV battery replacement", "60 × 2 sets × $410", "$49,300"],
                      ["UAV maintenance", "60 × $274", "$16,400"],
                      ["UGV maintenance + parts", "32 × $2,050", "$65,800"],
                      ["Balloon gas refill", "80 × $70 × 4 fills", "$22,400"],
                      ["Balloon skin replacement", "80 × $685 / 2 yr", "$27,400"],
                      ["Generator maintenance", "8 × $685", "$5,500"],
                      ["Warehouse maintenance", "4 sites × $4,110", "$16,400"],
                      ["Technical personnel", "4 staff × $20,500", "$82,200"],
                      ["Software & comms subscriptions", "—", "$27,400"],
                      ["Insurance", "—", "$41,100"],
                    ] as [string, string, string][]
                  ).map(([item, calc, cost]) => (
                    <tr key={item} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2 text-arc-fg/80">{item}</td>
                      <td className="hidden px-4 py-2 text-right text-arc-muted md:table-cell">
                        {calc}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-arc-fg">{cost}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-arc-accent/25 bg-arc-accent/5">
                    <td
                      colSpan={2}
                      className="px-4 py-3 font-mono text-xs font-medium uppercase tracking-[0.18em] text-arc-accent"
                    >
                      Annual total
                    </td>
                    <td className="px-4 py-3 text-right text-xl font-medium tabular-nums text-arc-accent">
                      ~$353,900
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Reveal>

          <Reveal className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
              <div className="border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                Single-incident cost — 72h deployment
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {(
                    [
                      ["Diesel consumption", "8 gen × 792 L × $1.10", "~$7,000"],
                      ["UAV battery degradation", "—", "~$4,100"],
                      ["Equipment attrition (est. 5%)", "total value × 5%", "~$266,000"],
                      ["Emergency personnel overtime", "—", "~$6,900"],
                    ] as [string, string, string][]
                  ).map(([item, calc, cost]) => (
                    <tr key={item} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-arc-fg/80">{item}</td>
                      <td className="hidden px-4 py-2.5 text-right text-arc-muted md:table-cell">
                        {calc}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-arc-fg">{cost}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-arc-warning/25 bg-arc-warning/5">
                    <td
                      colSpan={2}
                      className="px-4 py-3 font-mono text-xs font-medium uppercase tracking-[0.18em] text-arc-warning"
                    >
                      Per-incident total
                    </td>
                    <td className="px-4 py-3 text-right text-xl font-medium tabular-nums text-arc-warning">
                      ~$284,000
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Daily ops cost" value="$969" sub="$353,900 ÷ 365 days" />
              <StatCell
                label="10-year TCO"
                value="$9.3M"
                sub="vs $82M human-only"
                accent
              />
            </div>
          </Reveal>
        </div>
      </Sec>

      {/* ── ARC vs Human ─────────────────────────────── */}
      <Sec id="comparison">
        <Reveal>
          <Kicker>Module 05 · Effectiveness comparison</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            ARC versus human-only response.
          </h2>
          <p className="mt-4 max-w-2xl text-arc-muted">
            Benchmarked against a standard municipal allocation: 3 USAR heavy teams +
            10 light teams for a one-million-population city.
          </p>
        </Reveal>

        <Reveal className="mt-10 overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted">
                  Metric
                </th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted">
                  Human Only
                </th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.15em] text-arc-accent">
                  ARC + Human
                </th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.15em] text-arc-warning">
                  Ratio
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([m, h, a, r]) => (
                <tr key={m} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 text-arc-fg/85">{m}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-arc-muted">{h}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-arc-accent">{a}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-arc-warning">
                    {r}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>

        {/* Key finding callout */}
        <Reveal className="mt-6 rounded-md border border-arc-accent/30 bg-arc-accent/5 px-6 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-accent">
                Key finding
              </div>
              <p className="mt-2 max-w-2xl text-base font-medium text-arc-fg">
                ARC raises actual rescue count from ~105 to ~2,000 per major disaster — a net
                increase of{" "}
                <span className="text-arc-accent">~1,900 lives</span> at a system cost of
                $4,900 per life saved, versus $783,000 for human-only operations.
              </p>
            </div>
            <div className="shrink-0 font-mono text-5xl font-medium tabular-nums text-arc-accent">
              ×20
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-5 rounded-md border border-white/10 bg-[#0e1014] px-5 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-accent">
            Calculation footnotes
          </div>
          <div className="mt-3 grid gap-3 text-sm leading-relaxed text-arc-muted md:grid-cols-2">
            <p>
              <span className="text-arc-fg">$5.8M total investment</span> comes from
              ¥42.324M full-city deployment cost: 4 warehouse equipment sets, central
              control, communications infrastructure, installation, and commissioning.
            </p>
            <p>
              <span className="text-arc-fg">$4,900 per life saved</span> uses a 10-year
              TCO of ¥68.1M divided by ~1,900 net additional lives in one major disaster.
            </p>
            <p>
              <span className="text-arc-fg">×57 search efficiency</span> compares ARC
              24h full-city first scan capacity (~200 km²) against human-only 24h search
              coverage (~3.5 km²).
            </p>
            <p>
              <span className="text-arc-fg">20% rescue rate</span> is modeled as
              ~2,000 actual rescues out of ~10,000 trapped people, versus ~105 for the
              human-only baseline.
            </p>
          </div>
        </Reveal>

        {/* References */}
        <Reveal className="mt-10 border-t border-white/5 pt-8">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-arc-muted">
            Data sources
          </div>
          <ul className="grid gap-1.5 md:grid-cols-2">
            {[
              "DJI Enterprise — Matrice 350 RTK Specifications",
              "Milrem Robotics — THeMIS Technical Specifications",
              "INSARAG — International Search and Rescue Advisory Group Guidelines",
              "ResearchGate — Earthquake Survival Rate Statistical Analysis",
              "Atlas LTA — Tethered Aerostat Technical Specifications",
              "GenPower USA — Diesel Generator Fuel Consumption Data",
              "FEMA — US&R Response Capability Documentation",
              "NIH — Medical Research on Entrapment Survival",
            ].map((s) => (
              <li
                key={s}
                className="flex items-start gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-arc-muted/55"
              >
                <span className="mt-[0.35em] shrink-0">›</span>
                {s}
              </li>
            ))}
          </ul>
        </Reveal>
      </Sec>
    </PageShell>
  );
}
