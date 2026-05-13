"use client";

import { useEffect, useMemo, useState } from "react";
import { Vector3 } from "three";
import {
  applyWaypointLerp,
  ASSET_WAYPOINTS,
  getLoopTime,
  LOOP_SECONDS,
  SURVIVORS,
} from "./missionTimeline";
import {
  ALL_ASSETS,
  ASSET_META,
  AssetId,
  usePovTarget,
} from "./missionStore";

/**
 * Top-down minimap shown inside the POV HUD. Reveals the FPV asset's location
 * within the disaster zone, with buildings, survivors, and the rest of the
 * cluster all visible as markers.
 *
 * Coordinate system: SVG x maps to world x; SVG y maps to world z. Because
 * SVG's y-axis points down and the world's -z direction is "deeper into the
 * scene", this gives the conventional minimap orientation (deeper = higher
 * up in the panel, fronts = lower).
 */

// Building footprints (matches the values in missionTimeline's clearance comments)
type Box = { x: number; z: number; w: number; d: number; tier: "hero" | "mid" };

const BUILDINGS: Box[] = [
  // Hero buildings
  { x: -19, z: -23, w: 14, d: 14, tier: "hero" }, // apartment
  { x: 6, z: -27, w: 14, d: 14, tier: "hero" }, // mansion
  // Mid-layer
  { x: -23, z: -41, w: 14, d: 14, tier: "mid" }, // mid-multistory (relocated)
  { x: 15, z: -45, w: 14, d: 14, tier: "mid" }, // mid-mansion
  { x: -3, z: -49, w: 14, d: 14, tier: "mid" }, // mid-apartment
  { x: -26, z: -43, w: 14, d: 14, tier: "mid" }, // mid-multistory original
];

// MiniMap view bounds (svg viewBox in world units)
const VIEW = {
  x: -32,
  z: -50,
  w: 64,
  d: 75,
};

type AssetPlot = {
  id: AssetId;
  x: number;
  z: number;
  yaw: number;
  kind: "drone" | "dog";
};

export function MiniMap() {
  const povTarget = usePovTarget();
  // Force re-render every frame so the markers track motion
  const [, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Scratch vectors — reused per frame
  const scratch = useMemo(
    () => ({
      pos: new Vector3(),
      ahead: new Vector3(),
    }),
    [],
  );

  const t = getLoopTime();

  // Compute live asset plots
  const plots: AssetPlot[] = ALL_ASSETS.map((id) => {
    applyWaypointLerp(scratch.pos, ASSET_WAYPOINTS[id], t);
    applyWaypointLerp(
      scratch.ahead,
      ASSET_WAYPOINTS[id],
      Math.min(t + 0.4, LOOP_SECONDS - 0.01),
    );
    const dx = scratch.ahead.x - scratch.pos.x;
    const dz = scratch.ahead.z - scratch.pos.z;
    const yaw =
      dx * dx + dz * dz > 0.0001 ? Math.atan2(dx, dz) : Math.PI;
    return {
      id,
      x: scratch.pos.x,
      z: scratch.pos.z,
      yaw,
      kind: ASSET_META[id].kind,
    };
  });

  return (
    <div className="w-[200px] rounded-sm border border-arc-accent/30 bg-arc-bg/80 p-2 backdrop-blur-sm font-mono">
      <div className="mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-arc-muted">
        <span>Sector 14 · map</span>
        <span className="inline-block size-1 rounded-full bg-arc-accent" />
      </div>
      <svg
        viewBox={`${VIEW.x} ${VIEW.z} ${VIEW.w} ${VIEW.d}`}
        className="block h-[220px] w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {/* Faint grid every 10 units */}
        {[-30, -20, -10, 0, 10, 20].map((x) => (
          <line
            key={`gx${x}`}
            x1={x}
            y1={VIEW.z}
            x2={x}
            y2={VIEW.z + VIEW.d}
            stroke="#1a1d22"
            strokeWidth="0.2"
          />
        ))}
        {[-40, -30, -20, -10, 0, 10, 20].map((z) => (
          <line
            key={`gz${z}`}
            x1={VIEW.x}
            y1={z}
            x2={VIEW.x + VIEW.w}
            y2={z}
            stroke="#1a1d22"
            strokeWidth="0.2"
          />
        ))}

        {/* Buildings */}
        {BUILDINGS.map((b, i) => (
          <rect
            key={`b${i}`}
            x={b.x}
            y={b.z}
            width={b.w}
            height={b.d}
            fill={b.tier === "hero" ? "rgba(74,65,56,0.35)" : "rgba(58,52,44,0.25)"}
            stroke={b.tier === "hero" ? "#5a4838" : "#3a3a3a"}
            strokeWidth="0.4"
          />
        ))}

        {/* Survivor markers — animated pulse */}
        {SURVIVORS.map((s) => {
          const identified = t >= s.identifyAtT;
          const locked = t >= s.rescuedAtT;
          const color = locked ? "#5dffb4" : identified ? "#ffd95d" : "#ff7a40";
          return (
            <g key={s.id}>
              {identified && (
                <circle
                  cx={s.position[0]}
                  cy={s.position[2]}
                  r="2.5"
                  fill="none"
                  stroke={color}
                  strokeWidth="0.4"
                  opacity="0.6"
                >
                  <animate
                    attributeName="r"
                    values="2;4;2"
                    dur="1.6s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.6;0;0.6"
                    dur="1.6s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle cx={s.position[0]} cy={s.position[2]} r="1.2" fill={color} />
              <text
                x={s.position[0] + 2}
                y={s.position[2] + 1}
                fill={color}
                fontSize="2.2"
                fontFamily="monospace"
              >
                {s.id}
              </text>
            </g>
          );
        })}

        {/* Assets — drone triangles + dog squares; selected one highlighted */}
        {plots.map((a) => {
          const isMe = povTarget === a.id;
          const color = isMe
            ? "#5dffb4"
            : a.kind === "dog"
              ? "#5d9bff"
              : "#cfd4dc";
          const yawDeg = (a.yaw * 180) / Math.PI;
          // Heading line: short segment in the asset's facing direction
          const hx = a.x + Math.sin(a.yaw) * 3;
          const hz = a.z + Math.cos(a.yaw) * 3;
          return (
            <g key={a.id}>
              {/* Highlight ring for selected asset */}
              {isMe && (
                <circle
                  cx={a.x}
                  cy={a.z}
                  r="3"
                  fill="none"
                  stroke={color}
                  strokeWidth="0.5"
                  opacity="0.8"
                >
                  <animate
                    attributeName="r"
                    values="2.5;4;2.5"
                    dur="1.2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              {/* Heading line */}
              <line
                x1={a.x}
                y1={a.z}
                x2={hx}
                y2={hz}
                stroke={color}
                strokeWidth="0.4"
                opacity="0.85"
              />
              {/* Asset glyph: triangle for drones, square for dogs */}
              {a.kind === "drone" ? (
                <g transform={`translate(${a.x},${a.z}) rotate(${yawDeg})`}>
                  <polygon
                    points="0,-1.6 1.2,0.9 -1.2,0.9"
                    fill={color}
                    stroke={isMe ? color : "#0a0c10"}
                    strokeWidth="0.2"
                  />
                </g>
              ) : (
                <rect
                  x={a.x - 1.1}
                  y={a.z - 1.1}
                  width="2.2"
                  height="2.2"
                  fill={color}
                  stroke={isMe ? color : "#0a0c10"}
                  strokeWidth="0.2"
                />
              )}
              {/* Label */}
              <text
                x={a.x + 1.8}
                y={a.z + 2.6}
                fill={isMe ? color : "#8a8f98"}
                fontSize="1.9"
                fontFamily="monospace"
              >
                {ASSET_META[a.id].label}
              </text>
            </g>
          );
        })}

        {/* Compass — N indicator in top-right corner of the map */}
        <g transform={`translate(${VIEW.x + VIEW.w - 4} ${VIEW.z + 4})`}>
          <circle r="2.6" fill="rgba(10,12,16,0.7)" stroke="#3a3d44" strokeWidth="0.2" />
          <text
            x="0"
            y="1"
            textAnchor="middle"
            fontSize="2.4"
            fontFamily="monospace"
            fill="#8a8f98"
          >
            N
          </text>
        </g>
      </svg>
      <div className="mt-1.5 flex items-center justify-between text-[8px] uppercase tracking-[0.2em] text-arc-muted">
        <span className="flex items-center gap-1">
          <span aria-hidden className="inline-block size-1.5 rotate-45 bg-[#5d9bff]" />
          dog
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block size-0 border-x-[3px] border-b-[5px] border-x-transparent border-b-arc-fg"
          />
          drone
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="inline-block size-1.5 rounded-full bg-arc-warning" />
          target
        </span>
      </div>
    </div>
  );
}
