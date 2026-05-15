import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./demo-player.css";

export const metadata: Metadata = {
  title: "A.R.C. — Demo Player",
  description:
    "MapLibre tactical playback for precomputed timeline.json from arc_core or lite_sim.",
};

export default function DemoPlayerLayout({ children }: { children: React.ReactNode }) {
  return <div className="demo-player-shell">{children}</div>;
}
