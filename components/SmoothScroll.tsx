"use client";

import { ReactLenis } from "lenis/react";
import { useEffect, useState } from "react";

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      setEnabled(!mq.matches);
    };

    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <ReactLenis
      root
      options={{
        lerp: 0.09,
        smoothWheel: true,
        syncTouch: true,
        touchMultiplier: 1.15,
        wheelMultiplier: 0.9,
        touchInertiaExponent: 1.65,
        autoRaf: true,
        allowNestedScroll: true,
        anchors: true,
      }}
    >
      {children}
    </ReactLenis>
  );
}
