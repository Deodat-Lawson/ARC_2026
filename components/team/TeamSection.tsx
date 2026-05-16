"use client";

import { useInView } from "@/lib/useInView";

type Member = {
  callsign: string;
  name: string;
  role: string;
  specialty: string;
  status: "online" | "field" | "standby";
  sigil: "drone" | "ground" | "mesh" | "ai" | "ops" | "sensor";
};

const TEAM: Member[] = [
  {
    callsign: "PRIME-01",
    name: "Mission Lead",
    role: "Cluster Architect",
    specialty: "Heterogeneous swarm coordination",
    status: "online",
    sigil: "ops",
  },
  {
    callsign: "NEURO-02",
    name: "AI Lead",
    role: "Gemma 4 Integration",
    specialty: "On-device reasoning · task allocation",
    status: "online",
    sigil: "ai",
  },
  {
    callsign: "PERCH-03",
    name: "Aerial Systems",
    role: "Air Asset Engineer",
    specialty: "Long-endurance VTOL · payload mounting",
    status: "field",
    sigil: "drone",
  },
  {
    callsign: "TREAD-04",
    name: "Ground Systems",
    role: "UGV Engineer",
    specialty: "Mobile charging · debris navigation",
    status: "field",
    sigil: "ground",
  },
  {
    callsign: "WAVE-05",
    name: "Mesh & Comms",
    role: "Network Engineer",
    specialty: "Self-healing relay · emergency RF",
    status: "online",
    sigil: "mesh",
  },
  {
    callsign: "PULSE-06",
    name: "Perception",
    role: "Sensor Fusion Lead",
    specialty: "Thermal · acoustic · sub-audible vibration",
    status: "standby",
    sigil: "sensor",
  },
];

export function TeamSection() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section
      id="team"
      className="arc-home-deck arc-home-deck--team border-t border-white/5 px-6 py-24 md:px-10 md:py-32"
    >
      <div
        ref={ref}
        className={`mx-auto max-w-7xl transition-[opacity,transform] duration-700 ease-out ${
          inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
      >
        {/* Header */}
        <div className="mb-12 grid gap-10 md:mb-16 md:grid-cols-2 md:items-end md:gap-16">
          <div>
            <div className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-accent">
              <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" />
              The cluster
            </div>
            <h2 className="text-3xl font-medium leading-[1.1] tracking-tight text-arc-fg md:text-5xl">
              Operators behind the swarm.
            </h2>
          </div>
          <p className="max-w-xl text-base text-arc-muted md:text-lg">
            Each role owns a layer of the cluster — from on-device reasoning
            to airframes, treads, mesh comms, and sensor fusion. ARC is the
            sum of those six contracts holding.
          </p>
        </div>

        {/* Roster */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map((m, i) => (
            <OperatorCard key={m.callsign} member={m} index={i + 1} />
          ))}
        </div>

        {/* Cluster status footer */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-6 font-mono text-xs uppercase tracking-[0.24em] text-arc-muted">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]"
            />
            Cluster integrity · 6 / 6 contracts holding
          </div>
          <div>Last sync · T+0.0s</div>
        </div>
      </div>
    </section>
  );
}

function OperatorCard({ member, index }: { member: Member; index: number }) {
  const statusColor =
    member.status === "online"
      ? "text-arc-accent"
      : member.status === "field"
        ? "text-arc-warning"
        : "text-arc-muted";
  const statusDot =
    member.status === "online"
      ? "bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]"
      : member.status === "field"
        ? "bg-arc-warning shadow-[0_0_6px_2px_rgba(255,217,93,0.45)]"
        : "bg-arc-muted";

  return (
    <article className="group relative overflow-hidden rounded-md border border-white/10 bg-[#0e1014] p-4 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-arc-accent/40 hover:shadow-[0_20px_50px_-20px_rgba(93,255,180,0.25)]">
      {/* Top scan line on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-px left-4 right-4 h-px bg-gradient-to-r from-transparent via-arc-accent/60 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />

      {/* Header */}
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-arc-muted">
        <span>
          NODE · {index.toString().padStart(2, "0")}
        </span>
        <span className={`flex items-center gap-2 ${statusColor}`}>
          <span aria-hidden className={`inline-block size-1.5 rounded-full ${statusDot}`} />
          {member.status.toUpperCase()}
        </span>
      </div>

      {/* Sigil */}
      <div className="mt-4 flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-black/40 text-arc-accent">
          <Sigil kind={member.sigil} />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-arc-accent">
            {member.callsign}
          </div>
          <div className="mt-1 truncate text-base font-medium text-arc-fg">
            {member.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-arc-muted">
            {member.role}
          </div>
        </div>
      </div>

      {/* Specialty */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-arc-muted">
          Specialty
        </div>
        <div className="mt-1 text-sm leading-snug text-arc-fg/85">
          {member.specialty}
        </div>
      </div>

      {/* Footer telemetry strip */}
      <div className="mt-4 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-arc-muted">
        <span>uplink ▮▮▮▮▯</span>
        <span>sync · ok</span>
      </div>
    </article>
  );
}

function Sigil({ kind }: { kind: Member["sigil"] }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (kind) {
    case "drone":
      return (
        <svg {...common}>
          <circle cx="4" cy="4" r="2" />
          <circle cx="20" cy="4" r="2" />
          <circle cx="4" cy="20" r="2" />
          <circle cx="20" cy="20" r="2" />
          <path d="M6 6l4 4M18 6l-4 4M6 18l4-4M18 18l-4-4" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "ground":
      return (
        <svg {...common}>
          <rect x="4" y="9" width="16" height="7" rx="1" />
          <circle cx="8" cy="18" r="2" />
          <circle cx="16" cy="18" r="2" />
          <path d="M8 9V6h8v3" />
        </svg>
      );
    case "mesh":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="1.6" />
          <circle cx="18" cy="6" r="1.6" />
          <circle cx="6" cy="18" r="1.6" />
          <circle cx="18" cy="18" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <path d="M7.4 6.8L11 11M16.6 6.8L13 11M7.4 17.2L11 13M16.6 17.2L13 13" />
        </svg>
      );
    case "ai":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M9 9h6v6H9z" />
          <path d="M2 10h4M2 14h4M18 10h4M18 14h4M10 2v4M14 2v4M10 18v4M14 18v4" />
        </svg>
      );
    case "ops":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "sensor":
      return (
        <svg {...common}>
          <path d="M3 18a9 9 0 0118 0" />
          <path d="M7 18a5 5 0 0110 0" />
          <circle cx="12" cy="18" r="1.4" fill="currentColor" />
        </svg>
      );
  }
}
