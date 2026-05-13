"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe detection for "should we render the WebGL hero or the video fallback".
 * Returns true for narrow viewports OR low-core devices. Defaults to true on the
 * server so SSR emits the lighter fallback markup.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const lowCore =
      typeof navigator !== "undefined" &&
      typeof navigator.hardwareConcurrency === "number" &&
      navigator.hardwareConcurrency < 4;

    const update = () => setIsMobile(mql.matches || lowCore);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
}
