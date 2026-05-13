"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useIsMobile } from "@/lib/useIsMobile";
import { HeroFallback } from "./HeroFallback";
import { HeroOverlay } from "@/components/ui/HeroOverlay";

/**
 * Top-level hero. Device-gates between the WebGL canvas (desktop) and a
 * pre-rendered video loop (mobile / low-core devices). The DOM overlay sits
 * on top of either choice.
 *
 * HeroCanvas is loaded with `ssr: false` because R3F's Canvas (and three.js
 * internals) touch browser-only globals during render. Even inside a "use
 * client" boundary, Next still server-renders the tree once.
 */
const HeroCanvas = dynamic(
  () => import("./HeroCanvas").then((m) => m.HeroCanvas),
  { ssr: false, loading: () => <HeroFallback /> },
);

export function Hero() {
  const isMobile = useIsMobile();

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
      <HeroOverlay />
    </section>
  );
}
