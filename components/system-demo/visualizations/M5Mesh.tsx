"use client";

import { useEffect, useState } from "react";

/**
 * Module 05 — Ad-hoc mesh. A topology graph: ground command at the bottom,
 * a high-altitude relay drone overhead, perception drones around the site,
 * and a trapped civilian's distress beacon being acknowledged. Packets
 * travel along the active edges as moving dots.
 */

type NodeId = "CMD" | "RLY" | "A1" | "A2" | "A3" | "VIC";

const NODES: Record<NodeId, { x: number; y: number; label: string; role: string }> = {
  CMD: { x: 180, y: 230, label: "CMD", role: "COMMAND" },
  RLY: { x: 180, y: 60, label: "A-04", role: "RELAY" },
  A1: { x: 70, y: 130, label: "A-01", role: "SURVEY" },
  A2: { x: 290, y: 130, label: "A-02", role: "PERCEPTION" },
  A3: { x: 230, y: 180, label: "A-03", role: "RECHARGING" },
  VIC: { x: 90, y: 200, label: "T-01", role: "CIVILIAN" },
};

const EDGES: [NodeId, NodeId][] = [
  ["RLY", "CMD"],
  ["A1", "RLY"],
  ["A2", "RLY"],
  ["A3", "RLY"],
  ["A1", "VIC"],
];

export function M5Mesh() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const loop = (ts: number) => {
      if (start === null) start = ts;
      setT((ts - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative h-full w-full font-mono text-[10px] text-arc-fg/80">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 uppercase tracking-[0.2em]">
        <span className="text-arc-muted">mesh · sector 14</span>
        <span className="flex items-center gap-2 text-arc-accent">
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]"
          />
          LINK · 5/5
        </span>
      </div>

      <svg
        viewBox="0 0 360 260"
        preserveAspectRatio="xMidYMid meet"
        className="h-[calc(100%-2.25rem)] w-full"
      >
        <defs>
          <pattern id="grid5" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#1a1d22"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="360" height="260" fill="url(#grid5)" />

        {/* Faint signal rings */}
        <circle cx={NODES.RLY.x} cy={NODES.RLY.y} r="50" fill="none" stroke="#1c3a30" />
        <circle cx={NODES.RLY.x} cy={NODES.RLY.y} r="90" fill="none" stroke="#152721" />
        <circle cx={NODES.RLY.x} cy={NODES.RLY.y} r="130" fill="none" stroke="#0e1b18" />

        {/* Edges + packets */}
        {EDGES.map(([a, b], i) => {
          const A = NODES[a];
          const B = NODES[b];
          const phase = (t * 0.55 + i * 0.2) % 1;
          const px = A.x + (B.x - A.x) * phase;
          const py = A.y + (B.y - A.y) * phase;
          return (
            <g key={`${a}-${b}`}>
              <line
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke="#2a4d40"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <circle cx={px} cy={py} r="2.4" fill="#5dffb4">
                <animate
                  attributeName="opacity"
                  values="0.2;1;0.2"
                  dur="0.6s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          );
        })}

        {/* Civilian distress arrow back from A1 to VIC */}
        <line
          x1={NODES.A1.x}
          y1={NODES.A1.y}
          x2={NODES.VIC.x}
          y2={NODES.VIC.y}
          stroke="#ffd95d"
          strokeWidth="0.6"
          strokeDasharray="1 2"
        />

        {/* Nodes */}
        {(Object.keys(NODES) as NodeId[]).map((id) => (
          <NodeMark key={id} id={id} t={t} />
        ))}

        {/* Legend */}
        <g transform="translate(14 248)" fill="#8a8f98" fontSize="8" letterSpacing="1">
          <text>STATUS · sit-rep streaming · 142 KB/s · 38ms RTT</text>
        </g>
      </svg>
    </div>
  );
}

function NodeMark({ id, t }: { id: NodeId; t: number }) {
  const n = NODES[id];
  const isRelay = id === "RLY";
  const isCmd = id === "CMD";
  const isVic = id === "VIC";
  const pulse = (Math.sin(t * 3 + (isRelay ? 0 : 1.5)) + 1) * 0.5;

  const color = isVic ? "#ffd95d" : isCmd ? "#e8eaed" : "#5dffb4";

  return (
    <g transform={`translate(${n.x} ${n.y})`}>
      {isRelay && (
        <circle r={8 + pulse * 4} fill="none" stroke={color} strokeWidth="0.6" opacity={0.4} />
      )}
      <circle r="5" fill="#0e1014" stroke={color} strokeWidth="1.2" />
      <circle r="1.6" fill={color} />
      <text
        x={isCmd ? 0 : 9}
        y={isCmd ? 16 : 3}
        textAnchor={isCmd ? "middle" : "start"}
        fill={color}
        fontSize="8.5"
        letterSpacing="1"
      >
        {n.label}
      </text>
      <text
        x={isCmd ? 0 : 9}
        y={isCmd ? 26 : 13}
        textAnchor={isCmd ? "middle" : "start"}
        fill="#5a5f68"
        fontSize="7.5"
        letterSpacing="0.6"
      >
        {n.role}
      </text>
    </g>
  );
}
