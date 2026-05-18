"use client";

import { useEffect, useState } from "react";

/**
 * Module 04 — Energy. A fleet roster: 6 nodes with battery levels, role,
 * and status. Batteries tick down, one drops below threshold and is
 * re-tasked to RTB → CHARGING, while a ground UGV is dispatched as a
 * mobile charger.
 */

type Node = {
  id: string;
  kind: "AIR" | "GROUND";
  role: string;
  battery: number; // 0–100
  drain: number; // %/tick
  status: "ACTIVE" | "RTB" | "CHARGING" | "DISPATCH" | "STANDBY";
};

const SEED: Node[] = [
  { id: "A-01", kind: "AIR", role: "LEAD · SURVEY", battery: 78, drain: 0.45, status: "ACTIVE" },
  { id: "A-02", kind: "AIR", role: "PERCEPTION", battery: 64, drain: 0.55, status: "ACTIVE" },
  { id: "A-03", kind: "AIR", role: "PERCEPTION", battery: 31, drain: 0.50, status: "ACTIVE" },
  { id: "A-04", kind: "AIR", role: "RELAY", battery: 88, drain: 0.20, status: "ACTIVE" },
  { id: "A-05", kind: "AIR", role: "RESERVE", battery: 95, drain: 0.05, status: "STANDBY" },
  { id: "G-01", kind: "GROUND", role: "MOBILE CHARGER", battery: 96, drain: 0.08, status: "STANDBY" },
];

export function M4Energy() {
  const [fleet, setFleet] = useState<Node[]>(SEED);

  useEffect(() => {
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      setFleet((prev) => {
        const next = prev.map((n) => ({ ...n }));
        // Drain or charge each node
        next.forEach((n) => {
          if (n.status === "CHARGING") {
            n.battery = Math.min(100, n.battery + 2.4);
            if (n.battery >= 99) {
              n.status = "ACTIVE";
              n.drain = 0.5;
            }
          } else if (n.status !== "STANDBY") {
            n.battery = Math.max(0, n.battery - n.drain * 1.6);
          }
        });
        // A-03 hits threshold → RTB → CHARGING; G-01 dispatched
        const a3 = next.find((n) => n.id === "A-03");
        const g1 = next.find((n) => n.id === "G-01");
        if (a3 && g1) {
          if (a3.battery < 22 && a3.status === "ACTIVE") {
            a3.status = "RTB";
            g1.status = "DISPATCH";
          }
          if (a3.battery < 18 && a3.status === "RTB") {
            a3.status = "CHARGING";
            g1.status = "ACTIVE";
            g1.role = "DOCKED · A-03";
          }
        }
        // Reset cycle when A-03 fully recovered
        if (tick % 80 === 0) {
          return SEED.map((n) => ({ ...n }));
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  const airborne = fleet.filter((n) => n.status === "ACTIVE" && n.kind === "AIR").length;
  const avgBattery =
    Math.round(
      (fleet.reduce((s, n) => s + n.battery, 0) / fleet.length) * 10,
    ) / 10;

  return (
    <div className="relative flex h-full w-full flex-col font-mono text-[10px] text-arc-fg/80">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 uppercase tracking-[0.2em]">
        <span className="text-arc-muted">cluster · power · 6-node slice</span>
        <span className="flex items-center gap-4">
          <span>
            AIR <span className="text-arc-accent">{airborne}/4</span>
          </span>
          <span>
            AVG <span className="text-arc-fg">{avgBattery}%</span>
          </span>
        </span>
      </div>

      <div className="flex-1 divide-y divide-white/5 overflow-hidden">
        {fleet.map((n) => (
          <NodeRow key={n.id} node={n} />
        ))}
      </div>

      <div className="border-t border-white/5 px-4 py-2 text-arc-muted">
        Energy-aware planner active · idle nodes parked · mobile charger
        en route on threshold breach.
      </div>
    </div>
  );
}

function NodeRow({ node }: { node: Node }) {
  const tone =
    node.battery < 22
      ? "#ff5d6c"
      : node.battery < 40
        ? "#ffd95d"
        : "#5dffb4";

  const statusTone =
    node.status === "ACTIVE"
      ? "text-arc-accent"
      : node.status === "RTB"
        ? "text-arc-warning"
        : node.status === "CHARGING"
          ? "text-arc-accent"
          : node.status === "DISPATCH"
            ? "text-arc-warning"
            : "text-arc-muted";

  return (
    <div className="grid grid-cols-[3rem_5rem_1fr_4rem_4rem] items-center gap-3 px-4 py-2">
      <span className="text-arc-fg">{node.id}</span>
      <span className="text-arc-muted">{node.kind}</span>
      <span className="truncate text-arc-fg/80">{node.role}</span>
      <div className="relative h-2 w-16 overflow-hidden rounded-sm bg-white/5">
        <div
          className="h-full"
          style={{
            width: `${node.battery}%`,
            background: tone,
            boxShadow: `0 0 6px ${tone}55`,
            transition: "width 200ms linear",
          }}
        />
      </div>
      <span className={`text-right ${statusTone}`}>{node.status}</span>
    </div>
  );
}
