"use client";

/**
 * DOM layer over the canvas: wordmark, headline, sub, CTA, scroll affordance.
 * Sits on top of the 3D hero with pointer-events scoped so the canvas can
 * still receive future interactivity.
 */
export function HeroOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6 md:p-10">
      {/* Top bar */}
      <header className="pointer-events-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-2 rounded-full bg-arc-accent shadow-[0_0_8px_2px_rgba(93,255,180,0.6)]"
          />
          <span className="text-sm font-medium tracking-[0.2em] text-arc-fg">
            A.R.C.
          </span>
        </div>
        <nav className="hidden gap-8 text-sm text-arc-muted md:flex">
          <a href="#system" className="hover:text-arc-fg">
            System
          </a>
          <a href="#mission" className="hover:text-arc-fg">
            Mission
          </a>
          <a href="#team" className="hover:text-arc-fg">
            Team
          </a>
        </nav>
      </header>

      {/* Headline block */}
      <div className="pointer-events-auto max-w-3xl">
        <p className="mb-4 text-xs uppercase tracking-[0.32em] text-arc-accent">
          Autonomous Rescue Cluster · Powered by Gemma 4
        </p>
        <h1 className="text-4xl font-medium leading-[1.05] tracking-tight text-arc-fg md:text-6xl lg:text-7xl">
          When the network fails,
          <br />
          the swarm responds.
        </h1>
        <p className="mt-6 max-w-xl text-base text-arc-muted md:text-lg">
          An air-ground heterogeneous rescue network. Multi-sensor life
          perception, distributed task allocation, and zero-intervention closed
          loops — built to claim the golden window of post-disaster survival.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a
            href="#system"
            className="inline-flex h-11 items-center rounded-sm bg-arc-accent px-5 text-sm font-medium tracking-wide text-arc-bg transition-opacity hover:opacity-90"
          >
            Explore the system
          </a>
          <a
            href="#whitepaper"
            className="inline-flex h-11 items-center text-sm font-medium tracking-wide text-arc-fg underline decoration-arc-muted/60 underline-offset-4 hover:decoration-arc-fg"
          >
            Read the whitepaper
          </a>
        </div>
      </div>

      {/* Scroll affordance + status line */}
      <footer className="pointer-events-auto flex items-end justify-between">
        <div className="flex items-center gap-3 text-xs uppercase tracking-[0.24em] text-arc-muted">
          <span
            aria-hidden
            className="inline-block h-px w-10 bg-arc-muted/50"
          />
          Scroll
        </div>
        <div className="hidden text-right text-xs uppercase tracking-[0.2em] text-arc-muted md:block">
          <div>Cluster status</div>
          <div className="mt-1 text-arc-accent">Nominal · 6 nodes online</div>
        </div>
      </footer>
    </div>
  );
}
