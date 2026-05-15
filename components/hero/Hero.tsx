"use client";

import { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { useIsMobile } from "@/lib/useIsMobile";
import { HeroFallback } from "./HeroFallback";
import { HeroHUD } from "./HeroHUD";
import { PovHUD } from "./PovHUD";
import { SceneMapDebug } from "./SceneMapDebug";
import { getPovFromUrl, setPovTarget, usePovTarget } from "./missionStore";
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

const showSceneMapDebug = process.env.NEXT_PUBLIC_SHOW_SCENE_MAP_DEBUG === "1";

export function Hero() {
  const isMobile = useIsMobile();
  const povTarget = usePovTarget();
  const inFpv = povTarget !== "cinematic";

  // Restore POV from the URL `?pov=` query param after a hard refresh.
  // POV buttons hard-navigate (see setPovTargetViaUrl), so this is what
  // makes the scene mount in the right POV state after reload.
  useEffect(() => {
    setPovTarget(getPovFromUrl());
  }, []);

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
          {showSceneMapDebug && <SceneMapDebug />}
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
