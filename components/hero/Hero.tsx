"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useIsMobile } from "@/lib/useIsMobile";
import { HeroFallback } from "./HeroFallback";
import { HeroHUD } from "./HeroHUD";
import { PovHUD } from "./PovHUD";
import { usePovTarget } from "./missionStore";
import { HeroOverlay } from "@/components/ui/HeroOverlay";

/**
 * Top-level hero. Composes:
 *   • R3F canvas (desktop) or video fallback (mobile)
 *   • Mode-specific HUD layer: HeroHUD when cinematic, PovHUD in FPV
 *   • Marketing overlay (HeroOverlay) — hidden in FPV to clear the reticle
 */
const HeroCanvas = dynamic(
  () => import("./HeroCanvas").then((m) => m.HeroCanvas),
  { ssr: false, loading: () => <HeroFallback /> },
);

export function Hero() {
  const isMobile = useIsMobile();
  const povTarget = usePovTarget();
  const inFpv = povTarget !== "cinematic";

  return (
    <section className="relative h-screen w-full overflow-hidden bg-arc-bg">
      <div aria-hidden className="absolute inset-0">
        {isMobile ? (
          <HeroFallback />
        ) : (
          <Suspense fallback={<HeroFallback />}>
            <HeroCanvas />
          </Suspense>
        )}
      </div>
      {!isMobile && (
        <>
          <HeroHUD />
          <PovHUD />
        </>
      )}
      {/* Hide marketing copy during FPV so it doesn't fight the reticle */}
      <div
        className="transition-opacity duration-300"
        style={{ opacity: inFpv ? 0 : 1, pointerEvents: inFpv ? "none" : "auto" }}
      >
        <HeroOverlay />
      </div>
    </section>
  );
}
