"use client";

import { useEffect, useRef, useState } from "react";
import { SNAPSHOT } from "./CameraDebugOverlay";
import {
  AssetKind,
  REGIONS,
  Region,
  ResolvedPlacement,
  SCENE_BOUNDS,
  SURVIVORS,
  getResolvedPlacements,
} from "./sceneMap";
import { ASSET_WAYPOINTS, CAMERA_KEYS } from "./missionTimeline";

/**
 * Top-down minimap of the scene object map. Renders every region from
 * [sceneMap.ts](sceneMap.ts) as a translucent zone, every placement as a
 * footprint rectangle with its catalog label, and the live camera as a dot
 * with a forward indicator. Press M to toggle.
 *
 * Debug aid only — never gameplay state. When the 3D scene looks wrong,
 * glance here, identify the rogue object by id, then go fix sceneMap.ts.
 */

const KIND_STYLE: Record<AssetKind, { fill: string; stroke: string }> = {
  building: { fill: "rgba(180,150,110,0.5)",  stroke: "#c8a878" },
  vehicle:  { fill: "rgba(200,90,70,0.55)",   stroke: "#e0907a" },
  rubble:   { fill: "rgba(120,100,80,0.55)",  stroke: "#b09878" },
  sign:     { fill: "rgba(110,150,160,0.6)",  stroke: "#9ac0c8" },
};

const REGION_STYLE: Record<
  Region["kind"],
  { fill: string; stroke: string; dash?: string }
> = {
  alley: { fill: "rgba(255,80,80,0.10)", stroke: "#ff6060", dash: "3 3" },
  plaza: { fill: "rgba(120,180,220,0.08)", stroke: "#6fa8d6", dash: "2 4" },
  layer: { fill: "rgba(80,200,140,0.06)", stroke: "#5fd09a", dash: "4 6" },
};

const SURVIVOR_STYLE = { fill: "rgba(255,120,60,0.95)", stroke: "#ffe0a0" };

// Path colors keyed by asset id. Lead + dog1 stay cool (x=-1 column),
// perception + dog2 warm (x=2 column), relay neutral.
const PATH_COLORS: Record<string, string> = {
  lead:        "#6cf",
  perception:  "#ffb070",
  relay:       "#c0a8ff",
  dog1:        "#5fd09a",
  dog2:        "#ffd860",
};

// Horizontal half-FOV for the camera frustum overlay.
// Vertical FOV is 38°; at 16:9 aspect, horizontal ≈ 64° → half = 32°.
const HALF_HFOV = (32 * Math.PI) / 180;
const FRUSTUM_LEN = 60; // world units — roughly how far the eye reads before fog dominates

type SceneMapDebugProps = {
  variant?: "debug" | "hud";
};

export function SceneMapDebug({ variant = "debug" }: SceneMapDebugProps) {
  const isHud = variant === "hud";
  const [visible, setVisible] = useState(isHud);
  const [, force] = useState(0);
  const lastDraw = useRef(0);

  useEffect(() => {
    if (isHud) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHud]);

  useEffect(() => {
    if (!visible && !isHud) return;
    let raf = 0;
    const tick = (now: number) => {
      // 30Hz is plenty for a debug overlay; saves React work.
      if (now - lastDraw.current >= 33) {
        lastDraw.current = now;
        force((n) => (n + 1) & 0xffff);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isHud, visible]);

  if (!visible && !isHud) {
    return (
      <div className="pointer-events-none absolute right-3 top-3 z-50 rounded-sm border border-arc-accent/30 bg-black/50 px-2 py-1 font-mono text-[10px] text-arc-muted">
        [M] map
      </div>
    );
  }

  const W = isHud ? 220 : 280;
  const H = isHud ? 220 : 280;
  const sx = (x: number) => ((x - SCENE_BOUNDS.xMin) / (SCENE_BOUNDS.xMax - SCENE_BOUNDS.xMin)) * W;
  // z grows toward camera (+) — flip so deep-Z sits at the top of the minimap.
  const sz = (z: number) => H - ((z - SCENE_BOUNDS.zMin) / (SCENE_BOUNDS.zMax - SCENE_BOUNDS.zMin)) * H;
  const sw = (w: number) => (w / (SCENE_BOUNDS.xMax - SCENE_BOUNDS.xMin)) * W;
  const sh = (d: number) => (d / (SCENE_BOUNDS.zMax - SCENE_BOUNDS.zMin)) * H;

  const camX = sx(SNAPSHOT.px);
  const camY = sz(SNAPSHOT.pz);
  // SNAPSHOT.lx/lz is camera pos + forward * 1. Extend by 8 world units so
  // the forward indicator is actually visible on the minimap.
  const dirX = SNAPSHOT.lx - SNAPSHOT.px;
  const dirZ = SNAPSHOT.lz - SNAPSHOT.pz;
  const lookX = sx(SNAPSHOT.px + dirX * 8);
  const lookY = sz(SNAPSHOT.pz + dirZ * 8);

  // Top-down view frustum — shows what the camera is actually rendering.
  // Triangle from camera apex along the forward vector, rotated by ±HALF_HFOV.
  const dirLen = Math.hypot(dirX, dirZ);
  const fwdX = dirLen > 0.001 ? dirX / dirLen : 0;
  const fwdZ = dirLen > 0.001 ? dirZ / dirLen : -1;
  const cosH = Math.cos(HALF_HFOV);
  const sinH = Math.sin(HALF_HFOV);
  // Rotate forward by +half-FOV (left ray) and -half-FOV (right ray).
  const leftX = fwdX * cosH - fwdZ * sinH;
  const leftZ = fwdX * sinH + fwdZ * cosH;
  const rightX = fwdX * cosH + fwdZ * sinH;
  const rightZ = -fwdX * sinH + fwdZ * cosH;
  const apexPx = `${camX},${camY}`;
  const leftEnd = `${sx(SNAPSHOT.px + leftX * FRUSTUM_LEN)},${sz(SNAPSHOT.pz + leftZ * FRUSTUM_LEN)}`;
  const rightEnd = `${sx(SNAPSHOT.px + rightX * FRUSTUM_LEN)},${sz(SNAPSHOT.pz + rightZ * FRUSTUM_LEN)}`;

  const placements = getResolvedPlacements();

  return (
    <div
      className={[
        "pointer-events-none rounded-sm border border-arc-accent/40 p-2 font-mono text-[10px] leading-tight text-arc-accent backdrop-blur-sm",
        isHud
          ? "bg-arc-bg/80"
          : "absolute right-3 top-3 z-50 bg-black/80",
      ].join(" ")}
      style={{ width: W + 16 }}
    >
      <div className="mb-1 flex items-center justify-between text-arc-fg">
        <span>SCENE MAP · top-down</span>
        <span className="text-arc-muted">{isHud ? "LIVE" : "[M] hide"}</span>
      </div>
      <svg width={W} height={H} className="block rounded-sm bg-[#0a0807]">
        {/* World axes */}
        <line x1={sx(0)} y1={0} x2={sx(0)} y2={H} stroke="#3a2a1c" strokeWidth={1} />
        <line x1={0} y1={sz(0)} x2={W} y2={sz(0)} stroke="#3a2a1c" strokeWidth={1} />

        {/* Z grid lines every 10 units */}
        {[-90, -80, -70, -60, -50, -40, -30, -20, -10, 10].map((z) => (
          <line
            key={`gz${z}`}
            x1={0}
            y1={sz(z)}
            x2={W}
            y2={sz(z)}
            stroke="#1a1410"
            strokeWidth={0.5}
          />
        ))}

        {/* Regions (below placements) — layers first, alley on top so its
            dashed red border reads as a hard constraint. */}
        {REGIONS.filter((r) => r.kind !== "alley").map((r) => (
          <RegionRect key={r.id} region={r} sx={sx} sz={sz} sw={sw} sh={sh} />
        ))}
        {REGIONS.filter((r) => r.kind === "alley").map((r) => (
          <RegionRect key={r.id} region={r} sx={sx} sz={sz} sw={sw} sh={sh} />
        ))}

        {/* Placements with catalog labels */}
        {placements.map((p) => (
          <Footprint key={p.id} placement={p} sx={sx} sz={sz} sw={sw} sh={sh} />
        ))}

        {/* Survivors — canonical from missionTimeline */}
        {SURVIVORS.map((s) => (
          <g key={s.id}>
            <circle
              cx={sx(s.position[0])}
              cy={sz(s.position[2])}
              r={4}
              fill={SURVIVOR_STYLE.fill}
              stroke={SURVIVOR_STYLE.stroke}
              strokeWidth={1}
            />
            <text
              x={sx(s.position[0]) + 6}
              y={sz(s.position[2]) + 3}
              fill="#ffd8a0"
              fontSize={8}
            >
              {s.id}
            </text>
          </g>
        ))}

        {/* Asset waypoint paths — dashed polyline + dot per keyframe */}
        {(Object.entries(ASSET_WAYPOINTS) as [string, [number, number, number][]][]).map(
          ([id, waypoints]) => (
            <g key={`path-${id}`} opacity={0.65}>
              <polyline
                points={waypoints.map((w) => `${sx(w[0])},${sz(w[2])}`).join(" ")}
                fill="none"
                stroke={PATH_COLORS[id] ?? "#888"}
                strokeWidth={0.6}
                strokeDasharray="2 2"
              />
              {waypoints.map((w, i) => (
                <circle
                  key={`wp-${id}-${i}`}
                  cx={sx(w[0])}
                  cy={sz(w[2])}
                  r={1.4}
                  fill={PATH_COLORS[id] ?? "#888"}
                />
              ))}
            </g>
          ),
        )}

        {/* Cinematic camera path — six keyframes, brighter than asset paths */}
        <g opacity={0.85}>
          <polyline
            points={CAMERA_KEYS.map((k) => `${sx(k.pos[0])},${sz(k.pos[2])}`).join(" ")}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
          {CAMERA_KEYS.map((k, i) => (
            <g key={`camk-${i}`}>
              <circle cx={sx(k.pos[0])} cy={sz(k.pos[2])} r={2} fill="#ffffff" />
              <text
                x={sx(k.pos[0]) + 4}
                y={sz(k.pos[2]) - 4}
                fill="#ffffff"
                fontSize={7}
                opacity={0.7}
              >
                {i}
              </text>
            </g>
          ))}
        </g>

        {/* Live camera view-frustum + position */}
        <polygon
          points={`${apexPx} ${leftEnd} ${rightEnd}`}
          fill="rgba(110,200,255,0.10)"
          stroke="#6cf"
          strokeWidth={0.6}
          strokeDasharray="1 2"
        />
        <line x1={camX} y1={camY} x2={lookX} y2={lookY} stroke="#6cf" strokeWidth={1.5} />
        <circle cx={camX} cy={camY} r={3} fill="#6cf" />
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-arc-muted">
        <LegendDot c={KIND_STYLE.building.stroke} label="building" />
        <LegendDot c={KIND_STYLE.vehicle.stroke} label="vehicle" />
        <LegendDot c={KIND_STYLE.rubble.stroke} label="rubble" />
        <LegendDot c={KIND_STYLE.sign.stroke} label="sign" />
        <LegendDot c={REGION_STYLE.alley.stroke} label="alley (excl)" />
        <LegendDot c={SURVIVOR_STYLE.stroke} label="survivor" />
        <LegendDot c="#ffffff" label="cam path" />
        <LegendDot c={PATH_COLORS.lead} label="lead" />
        <LegendDot c={PATH_COLORS.perception} label="perception" />
        <LegendDot c={PATH_COLORS.relay} label="relay" />
        <LegendDot c={PATH_COLORS.dog1} label="dog1" />
        <LegendDot c={PATH_COLORS.dog2} label="dog2" />
        <LegendDot c="#6cf" label="cam now" />
      </div>
    </div>
  );
}

function RegionRect({
  region,
  sx,
  sz,
  sw,
  sh,
}: {
  region: Region;
  sx: (n: number) => number;
  sz: (n: number) => number;
  sw: (n: number) => number;
  sh: (n: number) => number;
}) {
  const style = REGION_STYLE[region.kind];
  const w = region.bounds.xMax - region.bounds.xMin;
  const d = region.bounds.zMax - region.bounds.zMin;
  const x = sx(region.bounds.xMin);
  const y = sz(region.bounds.zMax); // top = max-z (since we flip)
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={sw(w)}
        height={sh(d)}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={0.75}
        strokeDasharray={style.dash}
        rx={1}
      />
      <text x={x + 3} y={y + 9} fill={style.stroke} fontSize={7} opacity={0.7}>
        {region.id}
      </text>
    </g>
  );
}

function Footprint({
  placement,
  sx,
  sz,
  sw,
  sh,
}: {
  placement: ResolvedPlacement;
  sx: (n: number) => number;
  sz: (n: number) => number;
  sw: (n: number) => number;
  sh: (n: number) => number;
}) {
  const style = KIND_STYLE[placement.kind];
  const [fpW, fpD] = placement.footprint;
  const x = sx(placement.position[0]) - sw(fpW) / 2;
  const y = sz(placement.position[2]) - sh(fpD) / 2;
  const w = sw(fpW);
  const h = sh(fpD);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={0.75}
        rx={1}
      />
      {w > 14 && h > 8 && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 3}
          fill={style.stroke}
          fontSize={8}
          textAnchor="middle"
          opacity={0.9}
        >
          {placement.label}
        </text>
      )}
    </g>
  );
}

function LegendDot({ c, label }: { c: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      <span>{label}</span>
    </span>
  );
}
