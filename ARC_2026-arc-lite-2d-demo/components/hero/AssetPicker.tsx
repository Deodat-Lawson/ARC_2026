"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group } from "three";
import {
  ALL_ASSETS,
  ASSET_META,
  ASSET_POSITIONS,
  AssetId,
  setPovTarget,
  usePovTarget,
} from "./missionStore";

/**
 * Floating "FPV" labels anchored above each asset in the world. Click to
 * enter that asset's POV. The label of the currently-selected asset is
 * hidden (we're inside it). The label briefly shows "EXIT" when cinematic.
 *
 * Implementation: a wrapper <group> per asset whose position is updated
 * each frame from ASSET_POSITIONS. drei <Html> rides along.
 */
export function AssetPicker() {
  const povTarget = usePovTarget();

  // Refs for each asset's anchor group, indexed by AssetId
  const anchors = useRef<Partial<Record<AssetId, Group | null>>>({});

  useFrame(() => {
    for (const id of ALL_ASSETS) {
      const anchor = anchors.current[id];
      if (!anchor) continue;
      const p = ASSET_POSITIONS[id];
      // Place label ABOVE the asset
      const lift = ASSET_META[id].kind === "drone" ? 1.0 : 1.6;
      anchor.position.set(p.x, p.y + lift, p.z);
    }
  });

  return (
    <group>
      {ALL_ASSETS.map((id) => (
        <group
          key={id}
          ref={(el) => {
            anchors.current[id] = el;
          }}
        >
          {povTarget !== id && (
            <Html
              center
              distanceFactor={12}
              style={{ pointerEvents: "auto" }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPovTarget(id);
                }}
                className="group flex items-center gap-1 rounded-sm border border-white/15 bg-arc-bg/75 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-arc-fg/85 backdrop-blur-sm transition hover:border-arc-accent/80 hover:text-arc-accent"
              >
                <span
                  aria-hidden
                  className="inline-block size-1 rounded-full bg-arc-accent group-hover:shadow-[0_0_6px_2px_rgba(93,255,180,0.6)]"
                />
                {ASSET_META[id].label}
                <span className="text-arc-muted group-hover:text-arc-accent">· FPV</span>
              </button>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}
