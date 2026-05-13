"use client";

import { useState } from "react";

/**
 * Mobile + low-core fallback. Plays a pre-rendered loop of the same scene.
 *
 * Assets to drop in:
 *   /public/hero-fallback.mp4   — H.264, ~2 MB, 12s loop, 1080p
 *   /public/hero-fallback.webm  — VP9 alternative
 *   /public/hero-poster.webp    — frame 0, ~80 KB, doubles as LCP
 *
 * Until those exist, the `onError` handler swaps in a CSS-animated stand-in so
 * dev mode renders something rather than a black rectangle.
 */
export function HeroFallback() {
  const [videoOk, setVideoOk] = useState(true);

  if (!videoOk) return <CSSStandIn />;

  return (
    <video
      className="h-full w-full object-cover"
      autoPlay
      muted
      loop
      playsInline
      poster="/hero-poster.webp"
      preload="metadata"
      onError={() => setVideoOk(false)}
    >
      <source src="/hero-fallback.webm" type="video/webm" />
      <source src="/hero-fallback.mp4" type="video/mp4" />
    </video>
  );
}

/**
 * Pure-CSS placeholder: gradient sky over dark silhouette, slow horizontal
 * drift on a layered noise mask. Gives the page a non-broken look during dev
 * before the real video is rendered.
 */
function CSSStandIn() {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 80% at 30% 10%, #2a2218 0%, #14110d 55%, #0a0b0d 100%)",
      }}
    >
      {/* Sun glow */}
      <div
        aria-hidden
        className="absolute -top-24 left-1/4 size-[40rem] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,200,140,0.18), transparent 70%)",
          filter: "blur(20px)",
        }}
      />
      {/* Building silhouette band */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{
          background:
            "linear-gradient(to top, #0a0b0d 0%, #0a0b0d 35%, transparent 100%)",
        }}
      />
      <svg
        aria-hidden
        viewBox="0 0 1200 300"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-2/5 w-full"
      >
        <polygon
          points="0,300 0,180 80,200 130,140 220,160 260,90 340,110 380,170 470,150 540,80 620,120 680,60 780,100 860,140 950,90 1040,130 1120,110 1200,170 1200,300"
          fill="#16140f"
        />
        <polygon
          points="0,300 0,230 90,240 170,210 260,225 330,200 420,215 510,205 600,225 690,200 770,235 860,215 950,240 1040,225 1120,245 1200,220 1200,300"
          fill="#0d0c0a"
        />
      </svg>
      {/* Drifting dust band */}
      <div
        aria-hidden
        className="arc-dust-drift absolute inset-0 opacity-30 mix-blend-screen"
        style={{
          background:
            "repeating-linear-gradient(115deg, transparent 0 14px, rgba(217,201,163,0.06) 14px 16px)",
        }}
      />
    </div>
  );
}
