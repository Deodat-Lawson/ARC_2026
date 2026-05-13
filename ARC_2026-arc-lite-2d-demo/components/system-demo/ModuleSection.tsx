"use client";

import { ReactNode } from "react";
import { useInView } from "@/lib/useInView";

type Props = {
  index: string;
  kicker: string;
  title: string;
  body: string;
  bullets: string[];
  visualization: ReactNode;
  align?: "left" | "right";
};

export function ModuleSection({
  index,
  kicker,
  title,
  body,
  bullets,
  visualization,
  align = "left",
}: Props) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.15 });

  return (
    <section className="border-t border-white/5 px-6 py-24 md:px-10 md:py-32">
      <div
        ref={ref}
        className={`mx-auto grid max-w-7xl gap-10 transition-[opacity,transform] duration-700 ease-out md:grid-cols-2 md:gap-16 ${
          inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
      >
        <div
          className={`flex flex-col justify-center ${
            align === "right" ? "md:order-2" : ""
          }`}
        >
          <div className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-accent">
            <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" />
            {kicker}
          </div>
          <h2 className="text-3xl font-medium leading-[1.1] tracking-tight text-arc-fg md:text-5xl">
            {title}
          </h2>
          <p className="mt-6 max-w-xl text-base text-arc-muted md:text-lg">
            {body}
          </p>
          <ul className="mt-8 space-y-3">
            {bullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-3 text-sm text-arc-fg/85 md:text-base"
              >
                <span
                  aria-hidden
                  className="mt-[0.55em] inline-block size-1 shrink-0 rounded-full bg-arc-muted"
                />
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-10 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-arc-muted">
            <span>Module</span>
            <span className="text-arc-fg">{index}</span>
            <span aria-hidden className="inline-block h-px w-12 bg-white/10" />
          </div>
        </div>

        <div className={align === "right" ? "md:order-1" : ""}>
          <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-white/10 bg-[#0e1014] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
            {visualization}
          </div>
        </div>
      </div>
    </section>
  );
}
