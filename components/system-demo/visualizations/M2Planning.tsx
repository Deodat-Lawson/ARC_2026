"use client";

import { Suspense, useEffect, useState } from "react";
import { InjuredSoldierIcon3D } from "./InjuredSoldierIcon3D";

/**
 * Module 02 — Task allocation. A top-down tactical map. Drones (triangles) are
 * routed to survivor targets (numbered circles). As the planner converges, the
 * status flips from OPTIMIZING to PLAN LOCKED and the paths snap to their
 * final routing.
 */

type Target = {
  id: number;
  x: number;
  y: number;
  priority: number;
};

type DronePos = { x: number; y: number };

const TARGETS: Target[] = [
  { id: 1, x: 92, y: 70, priority: 0.94 },
  { id: 2, x: 210, y: 110, priority: 0.71 },
  { id: 3, x: 156, y: 178, priority: 0.62 },
  { id: 4, x: 268, y: 196, priority: 0.41 },
];

const DRONES_START: DronePos[] = [
  { x: 40, y: 220 },
  { x: 40, y: 220 },
  { x: 40, y: 220 },
  { x: 40, y: 220 },
];

// Final routing: drone[i] → target[i]
const ROUTES = [0, 1, 2, 3];

export function M2Planning() {
  const [optimizing, setOptimizing] = useState(true);
  const [progress, setProgress] = useState(0); // 0 → 1 path-draw

  useEffect(() => {
    let pos = 0;
    let raf = 0;
    const loop = () => {
      pos = (pos + 0.005) % 1.3; // overshoot then reset
      const eased = Math.min(1, pos);
      setProgress(eased);
      setOptimizing(pos < 1);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative h-full w-full font-mono text-[10px] text-arc-fg/80">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 uppercase tracking-[0.2em]">
        <span className="text-arc-muted">tactical · sector 14</span>
        <span
          className={`flex items-center gap-2 ${
            optimizing ? "text-arc-warning" : "text-arc-accent"
          }`}
        >
          <span
            aria-hidden
            className={`inline-block size-1.5 rounded-full ${
              optimizing ? "bg-arc-warning animate-pulse" : "bg-arc-accent"
            }`}
          />
          {optimizing ? "OPTIMIZING" : "PLAN LOCKED"}
        </span>
      </div>

      {/* Map */}
      <svg
        viewBox="0 0 340 240"
        className="h-[calc(100%-2.25rem)] w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid */}
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#1a1d22"
              strokeWidth="0.5"
            />
          </pattern>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#5dffb4" />
          </marker>
        </defs>
        <rect width="340" height="240" fill="url(#grid)" />

        {/* Damage rings */}
        <circle
          cx="170"
          cy="130"
          r="100"
          fill="none"
          stroke="#3a2a1c"
          strokeDasharray="3 4"
        />
        <circle
          cx="170"
          cy="130"
          r="60"
          fill="none"
          stroke="#3a2a1c"
          strokeDasharray="3 4"
          opacity="0.6"
        />
        <text
          x="170"
          y="32"
          textAnchor="middle"
          fill="#5a4a36"
          fontSize="9"
          letterSpacing="2"
        >
          EPICENTER · M6.8
        </text>

        {/* Paths */}
        {TARGETS.map((t, i) => {
          const start = DRONES_START[i];
          const end = TARGETS[ROUTES[i]];
          const mid = {
            x: (start.x + end.x) / 2 + (i % 2 === 0 ? -10 : 10),
            y: (start.y + end.y) / 2 - 14,
          };
          return (
            <g key={t.id}>
              <path
                d={`M ${start.x} ${start.y} Q ${mid.x} ${mid.y} ${end.x} ${end.y}`}
                stroke="#5dffb4"
                strokeWidth="1"
                fill="none"
                strokeDasharray="4 4"
                strokeDashoffset={(1 - progress) * 120}
                opacity={0.7 * progress}
              />
            </g>
          );
        })}

        {/* Targets (survivor markers) */}
        {TARGETS.map((t) => {
          const isPrimary = t.id === 1;
          return (
            <g key={`t${t.id}`}>
              <circle
                cx={t.x}
                cy={t.y}
                r="8"
                fill="none"
                stroke="#5dffb4"
                strokeWidth="1"
              />
              {isPrimary ? (
                <foreignObject
                  x={t.x - 14}
                  y={t.y - 9}
                  width="28"
                  height="18"
                >
                  <div style={{ width: "100%", height: "100%" }}>
                    <Suspense fallback={null}>
                      <InjuredSoldierIcon3D />
                    </Suspense>
                  </div>
                </foreignObject>
              ) : (
                <circle cx={t.x} cy={t.y} r="2" fill="#5dffb4" />
              )}
              <text
                x={t.x + 14}
                y={t.y - 6}
                fill="#5dffb4"
                fontSize="9"
                letterSpacing="1"
              >
                T-{t.id.toString().padStart(2, "0")}
              </text>
              <text
                x={t.x + 14}
                y={t.y + 6}
                fill="#8a8f98"
                fontSize="8"
                letterSpacing="0.5"
              >
                P {(t.priority * 100).toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Drones at base */}
        {DRONES_START.map((d, i) => (
          <g key={`d${i}`} transform={`translate(${d.x - 4 + i * 10} ${d.y})`}>
            <path d="M 0 -5 L 5 4 L -5 4 z" fill="#e8eaed" />
          </g>
        ))}

        <rect
          x="22"
          y="216"
          width="60"
          height="14"
          fill="none"
          stroke="#3a3d44"
        />
        <text x="52" y="226" textAnchor="middle" fill="#8a8f98" fontSize="8">
          STAGING
        </text>
      </svg>
    </div>
  );
}
