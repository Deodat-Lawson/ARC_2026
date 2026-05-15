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

function MarketModelNotes() {
  const notes: [string, string][] = [
    [
      "TAM",
      "$320B+ is the broad 2030 disaster management, public-safety robotics, humanitarian reconstruction, and infrastructure-security market context.",
    ],
    [
      "SAM",
      "$12.53B adds four serviceable scenarios: urban disaster pre-deployment, critical infrastructure, post-conflict search/demining, and CBRN response.",
    ],
    [
      "SOM",
      "$500M is the five-year capture target, equal to roughly 4% of SAM, not first-year revenue.",
    ],
    [
      "Revenue mix",
      "65% deployment revenue establishes the hardware footprint; 25% SaaS and 10% data services drive recurring margin after deployment.",
    ],
  ];

  return (
    <div className="rounded-md border border-white/10 bg-[#0e1014] px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-accent">
        Market model notes
      </div>
      <dl className="mt-3 grid gap-3 md:grid-cols-2">
        {notes.map(([label, value]) => (
          <div key={label} className="border-t border-white/5 pt-3 first:border-0 first:pt-0 md:first:border-t md:first:pt-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-arc-muted">
              {label}
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-arc-fg/85">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block size-1.5 rounded-full ${
            i < n
              ? "bg-arc-accent shadow-[0_0_4px_rgba(93,255,180,0.7)]"
              : "bg-white/15"
          }`}
        />
      ))}
    </span>
  );
}

function Sec({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-white/5 px-6 py-20 md:px-10 md:py-28">
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const MARKET_SEGMENTS = [
  {
    id: "A",
    title: "Urban Disaster Pre-deployment",
    sub: "Earthquake / hurricane / flood / wildfire",
    rows: [
      ["Cities > 1M (high-risk zones)", "200 cities", "$5.8M", "$1.16B"],
      ["Cities 100K–1M (high-risk)", "800 cities", "$2.0M", "$1.60B"],
      ["North American hurricane coast", "150 cities", "$3.0M", "$0.45B"],
      ["Wildfire zones (CA / AU / S.EU)", "100 areas", "$1.5M", "$0.15B"],
    ],
    total: "$3.36B",
  },
  {
    id: "B",
    title: "Critical Infrastructure Protection",
    sub: "Nuclear plants, chemical parks, refineries, dams",
    rows: [
      ["Nuclear power stations", "440 sites", "$3.0M", "$1.32B"],
      ["Large chemical parks", "2,000 sites", "$1.0M", "$2.00B"],
      ["Oil refineries", "700 sites", "$1.5M", "$1.05B"],
      ["Large dams / reservoirs", "500 sites", "$0.8M", "$0.40B"],
    ],
    total: "$4.77B",
  },
  {
    id: "C",
    title: "Post-conflict Search & Demining",
    sub: "Ukraine, Gaza, Syria, and other conflict zones",
    rows: [
      ["Ukraine demining (137,000 km²)", "National", "—", "$2.0B (addressable share)"],
      ["Gaza reconstruction search", "Regional", "—", "$0.5B"],
      ["Other conflict zones", "Multi-region", "—", "$0.5B"],
    ],
    total: "$3.0B",
  },
  {
    id: "D",
    title: "CBRN Hazardous Environments",
    sub: "Chemical, biological, radiological, nuclear response",
    rows: [
      ["Nuclear incident response (Fukushima-type)", "—", "—", "$0.5B"],
      ["Chemical leak / explosion search", "—", "—", "$0.5B"],
      ["Heavy-contamination zone survey", "—", "—", "$0.4B"],
    ],
    total: "$1.4B",
  },
];

const COMPETITORS = [
  {
    name: "A.R.C.",
    form: "Heterogeneous swarm",
    autonomy: 5,
    multi: 5,
    ai: "Gemma 4",
    offline: 5,
    relay: "Built-in (Balloon)",
    highlight: true,
  },
  {
    name: "DJI Enterprise",
    form: "UAV only",
    autonomy: 2,
    multi: 1,
    ai: "None",
    offline: 2,
    relay: "External required",
    highlight: false,
  },
  {
    name: "Skydio",
    form: "UAV only",
    autonomy: 4,
    multi: 2,
    ai: "Limited (obstacle)",
    offline: 3,
    relay: "External required",
    highlight: false,
  },
  {
    name: "Draganfly",
    form: "UAV only",
    autonomy: 2,
    multi: 1,
    ai: "None",
    offline: 2,
    relay: "External required",
    highlight: false,
  },
  {
    name: "Teledyne FLIR",
    form: "UGV + sensors",
    autonomy: 2,
    multi: 1,
    ai: "None",
    offline: 3,
    relay: "External required",
    highlight: false,
  },
  {
    name: "Milrem Robotics",
    form: "UGV only",
    autonomy: 3,
    multi: 2,
    ai: "Limited",
    offline: 3,
    relay: "External required",
    highlight: false,
  },
];

const REVENUE_STREAMS = [
  {
    pct: 65,
    label: "System Deployment",
    detail:
      "One-time delivery of hardware, software, and installation. Anchors the customer relationship and funds future SaaS.",
    gross: "~31% gross margin",
  },
  {
    pct: 25,
    label: "Annual SaaS Subscription",
    detail:
      "Software updates, remote monitoring, gas refills, and inspections. 57% gross margin — the engine of long-run profitability.",
    gross: "~57% gross margin",
  },
  {
    pct: 10,
    label: "Data Services",
    detail:
      "Post-disaster digital-twin reports and insurance risk-assessment datasets delivered as licensed data products.",
    gross: "~80% gross margin",
  },
];

const FORECAST: [string, string, string, string, string, string][] = [
  ["Y1", "2", "$12.0M", "$0.4M", "$12.0M", "$3.6M"],
  ["Y2", "3", "$17.4M", "$1.2M", "$18.6M", "$6.0M"],
  ["Y3", "5", "$29.0M", "$2.9M", "$31.9M", "$10.8M"],
  ["Y4", "8", "$46.4M", "$5.7M", "$52.1M", "$18.2M"],
  ["Y5", "12", "$69.6M", "$9.9M", "$79.5M", "$28.8M"],
];

const RISKS = [
  ["Airspace regulation (drone)", "High", "Post-disaster emergency exemptions + pre-cleared corridors"],
  ["AI mis-triage", "Medium", "Human confirmation backstop + redundant decision chains"],
  ["Competitor catch-up", "Medium", "Patent moat on swarm protocol + survival-probability algorithm"],
  ["Government payment willingness", "Medium", "Insurance co-financing model reduces direct public spend"],
  ["Supply chain (chips / vehicles)", "Low", "Multi-supplier strategy — core value is software platform"],
];

const CUSTOMERS = [
  { p: "P0", type: "National emergency management", n: "50+", eg: "China MEM, FEMA, Japan FSA", decision: "Minister / Director-General" },
  { p: "P0", type: "Nuclear power operators", n: "440", eg: "EDF, TEPCO, CGN", decision: "Safety Director" },
  { p: "P1", type: "City fire / civil defence", n: "1,000+", eg: "LAFD, Istanbul Civil Defence", decision: "Fire Chief" },
  { p: "P1", type: "Military / post-conflict", n: "20+ nations", eg: "Ukraine SESU, NATO", decision: "MoD / UN" },
  { p: "P2", type: "Chemical / energy groups", n: "2,700+", eg: "BASF, ExxonMobil, Sinopec", decision: "HSE Director" },
  { p: "P3", type: "Re/insurance", n: "50+", eg: "Munich Re, Swiss Re", decision: "CRO / Actuarial" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BPPage() {
  return (
    <PageShell>
      {/* ── Hero ─────────────────────────────────────── */}
      <section className="px-6 py-20 md:px-10 md:py-28">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Kicker>A.R.C. · Business Plan</Kicker>
            <h1 className="max-w-4xl text-4xl font-medium leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
              A $320B market.
              <br />
              <span className="text-arc-accent">Zero autonomous competitors.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base text-arc-muted md:text-lg">
              ARC is the only system combining heterogeneous swarm coordination, on-device AI
              reasoning, fully offline operation, and pre-deployed auto-wake. Market, model,
              and roadmap — by the numbers.
            </p>
          </Reveal>

          <Reveal className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCell label="Total addressable market" value="$320B+" sub="2030 forecast" />
            <StatCell label="Serviceable market (SAM)" value="$12.5B" sub="all addressable scenarios" accent />
            <StatCell label="5-year target (SOM)" value="$500M" sub="50 cities · 4% penetration" />
            <StatCell label="Net lives saved / year" value="~1,900" sub="per city deployment" accent />
          </Reveal>

          <Reveal className="mt-6">
            <MarketModelNotes />
          </Reveal>
        </div>
      </section>

      {/* ── Market Sizing ────────────────────────────── */}
      <Sec id="market">
        <Reveal>
          <Kicker>Module 01 · Market sizing</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            Four addressable verticals.
          </h2>
          <p className="mt-4 max-w-2xl text-arc-muted">
            ARC is not a {'"'}disaster drone{'"'} — it is a universal autonomous sensing and rescue
            operating system covering all disaster types and high-risk environments.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {MARKET_SEGMENTS.map((seg) => (
            <Reveal key={seg.id}>
              <div className="group relative overflow-hidden rounded-md border border-white/10 bg-[#0e1014] transition-[border-color,box-shadow] duration-200 hover:border-arc-accent/30 hover:shadow-[0_20px_60px_-15px_rgba(93,255,180,0.1)]">
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-arc-accent/50 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                />
                <div className="flex items-start justify-between border-b border-white/5 px-4 py-3">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                      Scenario {seg.id}
                    </div>
                    <div className="mt-1 font-medium text-arc-fg">{seg.title}</div>
                    <div className="mt-0.5 text-xs text-arc-muted">{seg.sub}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted">
                      SAM
                    </div>
                    <div className="mt-1 text-xl font-medium text-arc-accent">{seg.total}</div>
                  </div>
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/5">
                      {["Customer", "Count", "Deploy price", "Market"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-arc-muted ${
                            i === 0 ? "text-left" : "text-right"
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {seg.rows.map(([c, n, p, m]) => (
                      <tr key={c} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-2 text-arc-fg/80">{c}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-arc-muted">{n}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-arc-muted">{p}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-arc-fg">{m}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Reveal>
          ))}
        </div>

        {/* SAM total */}
        <Reveal className="mt-6 rounded-md border border-arc-accent/30 bg-arc-accent/5 px-6 py-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-accent">
                Total SAM
              </div>
              <p className="mt-1 text-arc-muted text-sm">
                A + B + C + D = $3.36B + $4.77B + $3.0B + $1.4B
              </p>
            </div>
            <div className="font-mono text-4xl font-medium tabular-nums text-arc-accent">
              $12.53B
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-4 rounded-md border border-white/10 bg-[#0e1014] px-5 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-accent">
            Source and calculation
          </div>
          <p className="mt-2 text-sm leading-relaxed text-arc-muted">
            SAM is modeled from the business-plan source as scenario A
            ($3.36B), B ($4.77B), C ($3.0B), and D ($1.4B). Deployment prices
            are tied to the cost model: large cities use the four-warehouse
            $3-6M configuration, smaller or single-site customers use reduced
            one-to-two warehouse configurations.
          </p>
        </Reveal>
      </Sec>

      {/* ── Competitive Matrix ───────────────────────── */}
      <Sec id="competition">
        <Reveal>
          <Kicker>Module 02 · Competitive landscape</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            No one else has all five.
          </h2>
          <p className="mt-4 max-w-2xl text-arc-muted">
            ARC occupies the sole intersection of heterogeneous multi-agent coordination,
            on-device large-model reasoning, full offline operation, and pre-deployed auto-wake.
          </p>
        </Reveal>

        <Reveal className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {["Vendor", "Platform form", "Autonomy", "Multi-agent", "Edge AI", "Offline ops", "Comms relay"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted ${
                        i === 0 ? "text-left" : "text-center"
                      }`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map((c) => (
                <tr
                  key={c.name}
                  className={`border-b border-white/5 last:border-0 ${
                    c.highlight
                      ? "bg-arc-accent/5"
                      : ""
                  }`}
                >
                  <td
                    className={`px-4 py-3 font-medium ${
                      c.highlight ? "text-arc-accent" : "text-arc-fg/80"
                    }`}
                  >
                    {c.name}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-arc-muted">{c.form}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <Stars n={c.autonomy} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <Stars n={c.multi} />
                    </div>
                  </td>
                  <td
                    className={`px-4 py-3 text-center text-xs ${
                      c.ai === "Gemma 4" ? "text-arc-accent" : "text-arc-muted"
                    }`}
                  >
                    {c.ai}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <Stars n={c.offline} />
                    </div>
                  </td>
                  <td
                    className={`px-4 py-3 text-center text-xs ${
                      c.relay === "Built-in (Balloon)" ? "text-arc-accent" : "text-arc-muted"
                    }`}
                  >
                    {c.relay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </Sec>

      {/* ── Revenue Model ────────────────────────────── */}
      <Sec id="revenue">
        <Reveal>
          <Kicker>Module 03 · Revenue architecture</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            Three compounding streams.
          </h2>
        </Reveal>

        <Reveal className="mt-10 grid gap-4 md:grid-cols-3">
          {REVENUE_STREAMS.map((s) => (
            <div
              key={s.label}
              className="group relative overflow-hidden rounded-md border border-white/10 bg-[#0e1014] p-5 transition-[border-color,box-shadow] duration-200 hover:border-arc-accent/30 hover:shadow-[0_20px_60px_-15px_rgba(93,255,180,0.1)]"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-arc-accent/50 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              />
              {/* percentage bar */}
              <div className="mb-4 h-1 w-full rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-arc-accent shadow-[0_0_8px_rgba(93,255,180,0.5)]"
                  style={{ width: `${s.pct}%` }}
                />
              </div>
              <div className="font-mono text-3xl font-medium tabular-nums text-arc-accent">
                {s.pct}%
              </div>
              <div className="mt-2 font-medium text-arc-fg">{s.label}</div>
              <p className="mt-3 text-sm leading-relaxed text-arc-muted">{s.detail}</p>
              <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-arc-accent/70">
                {s.gross}
              </div>
            </div>
          ))}
        </Reveal>

        {/* Per-city economics */}
        <Reveal className="mt-6 overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
          <div className="border-b border-white/5 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
            Unit economics — single city deployment
          </div>
          <div className="grid divide-y divide-white/5 text-sm md:grid-cols-2 md:divide-x md:divide-y-0">
            <table className="w-full">
              <tbody>
                {(
                  [
                    ["System deployment revenue", "$5,800,000"],
                    ["Hardware cost (COGS, 60%)", "−$3,480,000"],
                    ["Installation & delivery", "−$500,000"],
                    ["Deployment gross profit (31%)", "$1,820,000"],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <tr key={k} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-arc-muted">{k}</td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        k.includes("gross profit") ? "font-medium text-arc-accent" : "text-arc-fg"
                      }`}
                    >
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full">
              <tbody>
                {(
                  [
                    ["Annual SaaS revenue", "$350,000"],
                    ["Annual SaaS cost", "−$150,000"],
                    ["Annual SaaS gross profit (57%)", "$200,000 / yr"],
                    ["5-year cumulative ops profit", "$1,000,000"],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <tr key={k} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-arc-muted">{k}</td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        k.includes("gross profit") || k.includes("cumulative")
                          ? "font-medium text-arc-accent"
                          : "text-arc-fg"
                      }`}
                    >
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </Sec>

      {/* ── 5-Year Forecast ──────────────────────────── */}
      <Sec id="forecast">
        <Reveal>
          <Kicker>Module 04 · Five-year forecast</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            $500M cumulative by Year 5.
          </h2>
        </Reveal>

        <Reveal className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[560px] overflow-hidden rounded-md border border-white/10 bg-[#0e1014] text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {["Year", "Cities deployed", "Deployment rev.", "SaaS rev.", "Total revenue", "Gross profit"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {FORECAST.map(([yr, cities, dep, saas, total, gp], idx) => (
                <tr
                  key={yr}
                  className={`border-b border-white/5 last:border-0 ${
                    idx === FORECAST.length - 1 ? "bg-arc-accent/5" : ""
                  }`}
                >
                  <td
                    className={`px-4 py-3 font-mono font-medium ${
                      idx === FORECAST.length - 1 ? "text-arc-accent" : "text-arc-fg"
                    }`}
                  >
                    {yr}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-arc-muted">{cities}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-arc-fg">{dep}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-arc-fg">{saas}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${
                      idx === FORECAST.length - 1 ? "text-arc-accent" : "text-arc-fg"
                    }`}
                  >
                    {total}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      idx === FORECAST.length - 1 ? "font-medium text-arc-accent" : "text-arc-muted"
                    }`}
                  >
                    {gp}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>

        {/* Funding rounds */}
        <Reveal className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            { round: "Seed", amount: "$2M", timing: "Year 1", use: "Core algorithm R&D · first city pilot" },
            { round: "Series A", amount: "$10M", timing: "Year 2", use: "3-city deployment · team scale-up" },
            { round: "Series B", amount: "$30M", timing: "Year 3–4", use: "10-city rollout · international certification" },
          ].map((r) => (
            <div
              key={r.round}
              className="rounded-md border border-white/10 bg-[#0e1014] p-4"
            >
              <div className="flex items-start justify-between">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-arc-muted">
                  {r.round}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-arc-muted">
                  {r.timing}
                </div>
              </div>
              <div className="mt-2 text-2xl font-medium text-arc-fg">{r.amount}</div>
              <p className="mt-3 text-sm leading-relaxed text-arc-muted">{r.use}</p>
            </div>
          ))}
        </Reveal>
      </Sec>

      {/* ── Target Customers ─────────────────────────── */}
      <Sec id="customers">
        <Reveal>
          <Kicker>Module 05 · Target customers</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            Six customer archetypes.
          </h2>
        </Reveal>

        <Reveal className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[560px] overflow-hidden rounded-md border border-white/10 bg-[#0e1014] text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {["Priority", "Customer type", "Global count", "Example buyers", "Decision maker"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted ${
                        i === 0 ? "text-center" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {CUSTOMERS.map((c) => (
                <tr key={c.type} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${
                        c.p === "P0"
                          ? "bg-arc-accent/15 text-arc-accent"
                          : c.p === "P1"
                            ? "bg-arc-warning/15 text-arc-warning"
                            : "bg-white/8 text-arc-muted"
                      }`}
                    >
                      {c.p}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-arc-fg/90">{c.type}</td>
                  <td className="px-4 py-3 tabular-nums text-arc-muted">{c.n}</td>
                  <td className="px-4 py-3 text-arc-muted">{c.eg}</td>
                  <td className="px-4 py-3 text-arc-muted">{c.decision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </Sec>

      {/* ── Risk Register ────────────────────────────── */}
      <Sec id="risks">
        <Reveal>
          <Kicker>Module 06 · Risk register</Kicker>
          <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
            Risks and mitigations.
          </h2>
        </Reveal>

        <Reveal className="mt-10 overflow-hidden rounded-md border border-white/10 bg-[#0e1014]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {["Risk", "Level", "Mitigation"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted ${
                      i === 0 ? "text-left" : i === 1 ? "text-center" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RISKS.map(([risk, level, mit]) => (
                <tr key={risk} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 text-arc-fg/85">{risk}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${
                        level === "High"
                          ? "bg-arc-danger/15 text-arc-danger"
                          : level === "Medium"
                            ? "bg-arc-warning/15 text-arc-warning"
                            : "bg-white/8 text-arc-muted"
                      }`}
                    >
                      {level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-arc-muted">{mit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>

        {/* Social impact footer */}
        <Reveal className="mt-8 grid gap-3 md:grid-cols-3">
          {[
            { l: "Protected population (30 cities × 5yr)", v: "30,000,000+" },
            { l: "Extra lives saved per city disaster", v: "~1,900" },
            { l: "Search efficiency vs human-only", v: "×57" },
          ].map(({ l, v }) => (
            <div key={l} className="rounded-md border border-white/10 bg-[#0e1014] px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
                {l}
              </div>
              <div className="mt-2 text-2xl font-medium text-arc-accent">{v}</div>
            </div>
          ))}
        </Reveal>
      </Sec>
    </PageShell>
  );
}
