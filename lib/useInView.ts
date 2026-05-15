"use client";

import { useCallback, useState, type RefCallback } from "react";

type UseInViewOptions = {
  threshold?: number | number[];
  root?: Element | Document | null;
  rootMargin?: string;
};

/**
 * Returns a ref callback and whether the observed element is in the viewport.
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  options: UseInViewOptions = {},
): [RefCallback<T>, boolean] {
  const [inView, setInView] = useState(false);

  const ref = useCallback(
    (node: T | null) => {
      if (node === null) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          setInView(entry?.isIntersecting ?? false);
        },
        {
          threshold: options.threshold ?? 0,
          root: options.root ?? null,
          rootMargin: options.rootMargin,
        },
      );

      observer.observe(node);
      return () => observer.disconnect();
    },
    [options.threshold, options.root, options.rootMargin],
  );

  return [ref, inView];
}
