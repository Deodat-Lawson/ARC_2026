import type { Metadata } from "next";
import "./lite.css";

export const metadata: Metadata = {
  title: "A.R.C. Lite Simulation",
  description:
    "Gemma-powered rescue triage and mission planning simulator — 2D map + FPV preview.",
};

export default function LiteLayout({ children }: { children: React.ReactNode }) {
  return <div className="lite-page">{children}</div>;
}
