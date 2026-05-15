"use client";

import { useEffect, useState } from "react";
import {
  ALL_ASSETS,
  ASSET_META,
  AssetId,
  SENSOR_PROFILES,
  setPovTarget,
  usePovTarget,
} from "./missionStore";
import {
  currentPhaseIndex,
  getMissionTime,
  LOOP_SECONDS,
  PHASES,
} from "./missionTimeline";
import { HeroNarration } from "./HeroNarration";
import { MiniMap } from "./MiniMap";

/**
 * FPV operator console — shown only when in POV mode. Replaces the cinematic
 * HUD with the "you're inside the drone/dog" view.
 *
 * Layout:
 *   • Top bar:    asset ID + role + EXIT button
 *   • Top-right:  this asset's telemetry (alt/hdg/vel/pwr)
 *   • Bottom-left: mission phase indicator (same as cinematic, smaller)
 *   • Bottom-right: rolling sensor data tied to asset kind
 *   • Center: live "feed" reticle + crosshair (drone) or sensor sweep (dog)
 */
export function PovHUD() {
  const povTarget = usePovTarget();
  const [t, setT] = useState(0);
  const [isPovMenuOpen, setIsPovMenuOpen] = useState(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT(getMissionTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPovTarget("cinematic");
    };

    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, []);

  if (povTarget === "cinematic") return null;

  const assetId = povTarget as AssetId;
  const meta = ASSET_META[assetId];
  const loopT = t % LOOP_SECONDS;
  const phaseIdx = currentPhaseIndex(loopT);
  const phaseName = PHASES[phaseIdx].name;
  const isDrone = meta.kind === "drone";
  const profile = SENSOR_PROFILES[assetId];

  // Seeded telemetry (per-asset, smooth wandering)
  const seed = assetId.charCodeAt(0) * 0.13;
  const alt = isDrone ? 9 + Math.sin(t * 0.4 + seed) * 1.4 : 0.5;
  const hdg = (t * 6 + seed * 60) % 360;
  const vel = isDrone
    ? 7.4 + Math.sin(t * 0.6 + seed * 1.3) * 0.6
    : 1.6 + Math.sin(t * 0.6 + seed * 1.3) * 0.3;
  const battery = (isDrone ? 78 : 88) + Math.sin(t * 0.08 + seed) * 0.6;
  const lock = loopT >= 4.5 && loopT < 18.5;
  const confidence = sensorConfidence(assetId, loopT, t);

  return (
    <div className="pointer-events-none absolute inset-0 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-fg/80">
      {/* full-screen FPV scan-lines (a bit denser than cinematic mode) */}
      <div
        aria-hidden
        className="absolute inset-0 mix-blend-overlay opacity-80"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0) 0 2px, rgba(255,255,255,0.04) 2px 3px)",
        }}
      />

      {/* Subtle vignette to feel "lens-like" */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Top bar — FPV identity */}
      <div className="pointer-events-auto absolute left-1/2 top-20 -translate-x-1/2 md:top-6">
        <div className="flex items-center gap-4 rounded-sm border border-arc-accent/40 bg-arc-bg/80 px-4 py-2 shadow-[0_0_24px_rgba(93,255,180,0.08)] backdrop-blur-sm">
          <span className="flex items-center gap-2 text-arc-accent">
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.6)]"
            />
            LIVE · FPV
          </span>
          <span className="text-arc-fg">{meta.label}</span>
          <span className="text-arc-muted">{meta.role}</span>
          <span className="text-arc-muted">·</span>
          <span className="text-arc-fg">{phaseName}</span>
          <span className="text-arc-muted">·</span>
          <span className={confidence > 0.7 ? "text-arc-accent" : "text-arc-warning"}>
            {Math.round(confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Dedicated POV controls: high layer, large target, and keyboard reachable. */}
      <div className="pointer-events-auto absolute right-6 top-6 z-50 md:right-10">
        <PovSwitcher
          currentAssetId={assetId}
          isOpen={isPovMenuOpen}
          onOpenChange={setIsPovMenuOpen}
          onSelect={(target) => setPovTarget(target)}
        />
      </div>

      {/* Corner brackets (FPV frame) */}
      <FpvBrackets />

      {/* Center reticle */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {isDrone ? (
          <DroneReticle locked={lock} />
        ) : (
          <DogReticle locked={lock} />
        )}
      </div>

      {/* Top-right: telemetry */}
      <div className="absolute right-6 top-24 md:right-10">
        <div className="min-w-[210px] rounded-sm border border-arc-accent/30 bg-arc-bg/75 p-3 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between text-arc-muted">
            <span>Self · {meta.label}</span>
            <span className="text-[9px] text-arc-fg/70">{profile.feed}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <Row label="ALT" value={isDrone ? `${alt.toFixed(1)}m` : "GND"} />
            <Row label="HDG" value={`${hdg.toFixed(0).padStart(3, "0")}°`} />
            <Row label="VEL" value={`${vel.toFixed(1)}m/s`} />
            <Row label="PWR" value={`${battery.toFixed(0)}%`} tone="ok" />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px]">
            <span className="text-arc-muted">LINK</span>
            <span className="text-arc-accent">{profile.link}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-[9px]">
            <SignalPip label="THM" value={profile.thermal} />
            <SignalPip label="AUD" value={profile.acoustic} />
            <SignalPip label="VIB" value={profile.vibration} />
          </div>
        </div>
      </div>

      {/* Bottom-left: phase scrubber (compact) */}
      <div className="absolute bottom-6 left-6 md:left-10">
        <div className="w-[220px] rounded-sm border border-white/10 bg-arc-bg/70 p-2 backdrop-blur-sm">
          <div className="mb-1.5 flex items-center justify-between text-[9px]">
            <span className="text-arc-muted">PHASE</span>
            <span className="text-arc-accent">{phaseName}</span>
          </div>
          <div className="flex gap-1">
            {PHASES.map((p, i) => (
              <div key={p.name} className="relative h-1 flex-1 overflow-hidden bg-white/5">
                <div
                  className="h-full bg-arc-accent"
                  style={{ width: i <= phaseIdx ? "100%" : "0%", opacity: i < phaseIdx ? 0.45 : 1 }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom-right: asset-specific sensor readout */}
      <div className="absolute bottom-6 right-6 md:right-10">
        <SensorReadout
          assetId={assetId}
          confidence={confidence}
          t={t}
          lock={lock}
          phaseName={phaseName}
        />
      </div>

      {/* Top-left: minimap revealing this asset's location in the disaster zone.
          The tiny CAM label is folded into the minimap panel header. */}
      <div className="absolute left-6 top-24 flex flex-col gap-2 md:left-10">
        <MiniMap />
        <div className="text-[9px] text-arc-muted">
          {`CAM · ${profile.feed} · ${profile.primary}`}
        </div>
      </div>

      {/* Cinematic narration line — what's happening RIGHT NOW */}
      <div className="absolute bottom-28 left-1/2 max-w-[60%] -translate-x-1/2 md:bottom-32">
        <HeroNarration compact />
      </div>
    </div>
  );
}

// ---- subcomponents ----

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const tint =
    tone === "ok"
      ? "text-arc-accent"
      : tone === "warn"
        ? "text-arc-warning"
        : "text-arc-fg";
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <span className="text-arc-muted">{label}</span>
      <span className={tint}>{value}</span>
    </div>
  );
}

function SignalPip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-white/10 bg-white/[0.03] px-1.5 py-1">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-arc-muted">{label}</span>
        <span className={value > 0.72 ? "text-arc-accent" : "text-arc-fg/70"}>
          {Math.round(value * 100)}
        </span>
      </div>
      <div className="h-0.5 bg-white/10">
        <div
          className="h-full bg-arc-accent"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
    </div>
  );
}

function PovSwitcher({
  currentAssetId,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  currentAssetId: AssetId;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (target: "cinematic" | AssetId) => void;
}) {
  const current = ASSET_META[currentAssetId];

  const chooseTarget = (target: "cinematic" | AssetId) => {
    onOpenChange(false);
    onSelect(target);
  };

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Switch POV or exit. Current POV ${current.label}`}
        title="Switch POV or exit (Esc)"
        onClick={() => onOpenChange(!isOpen)}
        className="flex min-h-[44px] items-center rounded-sm border border-arc-accent/60 bg-arc-bg/95 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-arc-accent shadow-[0_0_24px_rgba(93,255,180,0.18)] backdrop-blur-sm transition hover:border-arc-accent hover:bg-arc-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arc-accent focus-visible:ring-offset-2 focus-visible:ring-offset-arc-bg"
      >
        <span>{current.label}</span>
        <span className="ml-2 text-arc-fg/70">POV</span>
        <span aria-hidden className="ml-3 text-arc-accent">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-sm border border-arc-accent/50 bg-arc-bg/95 text-[10px] shadow-[0_18px_42px_rgba(0,0,0,0.45)] backdrop-blur-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => chooseTarget("cinematic")}
            className="flex min-h-[44px] w-full items-center justify-between border-b border-white/10 px-3 py-2 text-left text-arc-accent transition hover:bg-arc-accent/10 focus-visible:bg-arc-accent/10 focus-visible:outline-none"
          >
            <span>Exit POV</span>
            <span className="text-[9px] text-arc-fg/60">Esc</span>
          </button>

          {ALL_ASSETS.map((id) => {
            const asset = ASSET_META[id];
            const isCurrent = id === currentAssetId;

            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => chooseTarget(id)}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none disabled:cursor-default disabled:bg-arc-accent/10"
                disabled={isCurrent}
              >
                <span className={isCurrent ? "text-arc-accent" : "text-arc-fg"}>
                  {asset.label}
                </span>
                <span className="truncate text-right text-[9px] text-arc-muted">
                  {isCurrent ? "Current" : asset.role}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FpvBrackets() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {[
        { x1: 2, y1: 10, x2: 2, y2: 2, x3: 10, y3: 2 },
        { x1: 90, y1: 2, x2: 98, y2: 2, x3: 98, y3: 10 },
        { x1: 2, y1: 90, x2: 2, y2: 98, x3: 10, y3: 98 },
        { x1: 90, y1: 98, x2: 98, y2: 98, x3: 98, y3: 90 },
      ].map((c, i) => (
        <polyline
          key={i}
          points={`${c.x1},${c.y1} ${c.x2},${c.y2} ${c.x3},${c.y3}`}
          fill="none"
          stroke="#5dffb4"
          strokeWidth="0.22"
          opacity="0.85"
        />
      ))}
    </svg>
  );
}

function DroneReticle({ locked }: { locked: boolean }) {
  const color = locked ? "#5dffb4" : "#ffd95d";
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
      {/* Outer ring */}
      <circle cx="60" cy="60" r="40" fill="none" stroke="#5dffb4" strokeWidth="0.6" opacity="0.45" />
      {/* Inner reticle */}
      <circle cx="60" cy="60" r="12" fill="none" stroke={color} strokeWidth="1" />
      <line x1="60" y1="30" x2="60" y2="48" stroke={color} strokeWidth="0.8" />
      <line x1="60" y1="72" x2="60" y2="90" stroke={color} strokeWidth="0.8" />
      <line x1="30" y1="60" x2="48" y2="60" stroke={color} strokeWidth="0.8" />
      <line x1="72" y1="60" x2="90" y2="60" stroke={color} strokeWidth="0.8" />
      <circle cx="60" cy="60" r="1.5" fill={color} />
      {/* corner ticks */}
      <line x1="20" y1="60" x2="26" y2="60" stroke="#5dffb4" strokeWidth="0.6" />
      <line x1="94" y1="60" x2="100" y2="60" stroke="#5dffb4" strokeWidth="0.6" />
      <line x1="60" y1="20" x2="60" y2="26" stroke="#5dffb4" strokeWidth="0.6" />
      <line x1="60" y1="94" x2="60" y2="100" stroke="#5dffb4" strokeWidth="0.6" />
      {locked && (
        <text
          x="60"
          y="108"
          textAnchor="middle"
          fill={color}
          fontSize="6"
          letterSpacing="2"
        >
          LOCK · 87%
        </text>
      )}
    </svg>
  );
}

function DogReticle({ locked }: { locked: boolean }) {
  const color = locked ? "#5dffb4" : "#5d9bff";
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
      {/* Dog has a more "sensor sweep" reticle — horizontal scan bars */}
      <line x1="20" y1="60" x2="100" y2="60" stroke={color} strokeWidth="0.6" opacity="0.5" />
      <line x1="40" y1="40" x2="80" y2="40" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <line x1="40" y1="80" x2="80" y2="80" stroke={color} strokeWidth="0.5" opacity="0.3" />
      {/* Center pip */}
      <circle cx="60" cy="60" r="2.5" fill="none" stroke={color} strokeWidth="1" />
      <circle cx="60" cy="60" r="6" fill="none" stroke={color} strokeWidth="0.4" opacity="0.5" />
      {/* tick marks */}
      <line x1="60" y1="50" x2="60" y2="55" stroke={color} strokeWidth="0.6" />
      <line x1="60" y1="65" x2="60" y2="70" stroke={color} strokeWidth="0.6" />
      <text x="60" y="34" textAnchor="middle" fill="#8a8f98" fontSize="5" letterSpacing="2">
        SENSOR SWEEP
      </text>
    </svg>
  );
}

function SensorReadout({
  assetId,
  confidence,
  t,
  lock,
  phaseName,
}: {
  assetId: AssetId;
  confidence: number;
  t: number;
  lock: boolean;
  phaseName: string;
}) {
  const meta = ASSET_META[assetId];
  const profile = SENSOR_PROFILES[assetId];
  const wave = generateMiniWave(t, lock);

  return (
    <div className="w-[260px] rounded-sm border border-white/10 bg-arc-bg/70 p-2 backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between text-[9px]">
        <span className="text-arc-muted">
          {meta.kind === "drone" ? "FUSED SENSOR" : "GROUND SENSOR"}
        </span>
        <span className={lock ? "text-arc-accent" : "text-arc-muted"}>
          {lock
            ? `POSITIVE · ${(2.2 + confidence * 2.7).toFixed(1)}σ`
            : phaseName === "IDENTIFY"
              ? "RISING"
              : "baseline"}
        </span>
      </div>
      <svg viewBox="0 0 260 36" className="h-9 w-full">
        <path d={wave} stroke={lock ? "#5dffb4" : "#5d9bff"} strokeWidth="1" fill="none" />
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-arc-muted">
        <span>{profile.primary}</span>
        <span>·</span>
        <span>
          {lock ? `${profile.target} confirmed` : `${profile.target} candidate`}
        </span>
      </div>
    </div>
  );
}

function sensorConfidence(assetId: AssetId, loopT: number, t: number): number {
  const base = SENSOR_PROFILES[assetId];
  const weighted = base.thermal * 0.38 + base.acoustic * 0.34 + base.vibration * 0.28;
  const phaseBoost =
    loopT >= 13 ? 0.14 : loopT >= 7 ? 0.08 : loopT >= 4.5 ? 0.04 : -0.08;
  const noise = Math.sin(t * 1.7 + assetId.length) * 0.025;
  return Math.max(0.08, Math.min(0.98, weighted + phaseBoost + noise));
}

function generateMiniWave(t: number, lock: boolean): string {
  const pts: string[] = [];
  for (let x = 0; x <= 260; x += 3) {
    const phase = (x + t * 40) * 0.18;
    let y = 18 + Math.sin(phase) * 1.6 + Math.sin(phase * 2.3) * 0.7;
    if (lock) {
      // Inject a strong heartbeat every ~50px
      const m = x % 50;
      if (m > 2 && m < 7) y -= Math.sin(((m - 2) / 5) * Math.PI) * 9;
      else if (m > 8 && m < 13) y += Math.sin(((m - 8) / 5) * Math.PI) * 4;
    }
    pts.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(2)}`);
  }
  return pts.join(" ");
}
