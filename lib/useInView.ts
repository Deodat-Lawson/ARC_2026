"use client";

import { useEffect, useRef, useState } from "react";

/**
 * IntersectionObserver-backed visibility hook. Stays `true` once entered so
 * reveal animations don't replay on every scroll-up.
 */
export function useInView<T extends Element = HTMLElement>(
  options: IntersectionObserverInit = { threshold: 0.25 },
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setInView(true);
          obs.disconnect();
          break;
        }
      }
    }, options);
    obs.observe(node);
    return () => obs.disconnect();
  }, [inView, options]);

  return [ref, inView];
}
