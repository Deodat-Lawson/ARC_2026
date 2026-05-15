"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Whitepaper", href: "/whitepaper" },
  { label: "Cost", href: "/Cost" },
  { label: "Business Plan", href: "/BP" },
  { label: "Central Control", href: "/Central-control" },
];

export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-arc-bg text-arc-fg">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[rgba(10,11,13,0.92)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:px-10">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full bg-arc-accent shadow-[0_0_8px_2px_rgba(93,255,180,0.6)]"
            />
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-arc-fg">
              A.R.C.
            </span>
          </Link>

          <nav className="flex items-center gap-7 font-mono text-[11px] uppercase tracking-[0.22em]">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={
                  pathname === n.href
                    ? "text-arc-accent"
                    : "text-arc-muted transition-colors duration-150 hover:text-arc-fg"
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {children}
    </div>
  );
}
