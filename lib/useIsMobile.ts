"use client";

import { useEffect, useState } from "react";

/** Matches Tailwind `md` (768px): below that counts as mobile for hero routing. */
const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return mobile;
}
