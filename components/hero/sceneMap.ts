"use client";

import { SURVIVORS } from "./missionTimeline";

/**
 * SCENE OBJECT MAP — single source of truth for everything physical in the
 * disaster zone.
 *
 * Read top-down:
 *   1. MATERIALS     KBS105 PBR variants (texture paths + triplanar params)
 *   2. CATALOG       Per-GLB defaults: kind, material, height, footprint
 *   3. REGIONS       Named zones with bounds (alley exclusion, layer bands)
 *   4. PLACEMENTS    Short table — what asset, where, plus optional overrides
 *   5. API           resolvePlacement / getResolvedPlacements / validate
 *
 * Constraints — do NOT change without re-calibrating
 * [missionTimeline.ts](missionTimeline.ts) waypoints:
 *   • Central alley x∈[-2,3], z∈[-32,-6] stays geometry-free.
 *   • The 5 hero/mid building positions are referenced by per-phase waypoints
 *     (see missionTimeline.ts:163-238 — the building footprint table).
 *
 * Survivor positions are canonical in missionTimeline.ts and re-exported
 * from here so the minimap can render them without duplicating coordinates.
 */

// ============================================================================
// 1. MATERIALS REGISTRY
// ============================================================================
// Drives texture loading in [Scene.tsx](Scene.tsx). Each entry yields one
// triplanar PBR material. Scale tuned per surface: metals tile small, concretes
// large, plaster between.

// Four variants. Each is loaded by its own dedicated `useTexture` call in
// [Scene.tsx](Scene.tsx) — no dynamic-key map, no chance of a silent miss.
// Variants chosen so every catalog entry gets a sensible default:
//   concrete  → general structural surfaces (towers, facades, rubble)
//   bricks    → damaged residential walls (apartments)
//   plaster   → softer, lighter buildings (mansions)
//   metal     → vehicles + sign posts
export type MaterialId = "concrete" | "bricks" | "plaster" | "metal";

export type MaterialDef = {
  basecolor: string;
  normalMap: string;
  roughnessMap: string;
  /** World-space tile scale for the triplanar projection. */
  triplanarScale: number;
  /** Default roughness scalar; the map (if any) multiplies in. */
  roughness: number;
  /** 0..1. Set >0 only for metals. */
  metalness: number;
};

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  concrete: {
    basecolor: "/textures/concrete-a_basecolor.jpg",
    normalMap: "/textures/concrete-a_normal.jpg",
    roughnessMap: "/textures/concrete-a_roughness.jpg",
    triplanarScale: 0.16,
    roughness: 1.0,
    metalness: 0.0,
  },
  bricks: {
    basecolor: "/textures/bricks-damage_basecolor.jpg",
    normalMap: "/textures/bricks-damage_normal.jpg",
    roughnessMap: "/textures/bricks-damage_roughness.jpg",
    triplanarScale: 0.22,
    roughness: 0.95,
    metalness: 0.0,
  },
  plaster: {
    basecolor: "/textures/plaster-a_basecolor.jpg",
    normalMap: "/textures/plaster-a_normal.jpg",
    roughnessMap: "/textures/plaster-a_roughness.jpg",
    triplanarScale: 0.18,
    roughness: 0.92,
    metalness: 0.0,
  },
  metal: {
    basecolor: "/textures/metal-rust_basecolor.jpg",
    normalMap: "/textures/metal-rust_normal.jpg",
    roughnessMap: "/textures/metal-rust_roughness.jpg",
    triplanarScale: 0.65,
    roughness: 0.7,
    metalness: 0.55,
  },
};

// ============================================================================
// 2. ASSET CATALOG
// ============================================================================
// One entry per GLB. Placements reference these — defaults here are the
// single point to tune if e.g. every taxi should be slightly larger.

export type AssetKind = "building" | "vehicle" | "rubble" | "sign";

export type AssetCatalogEntry = {
  glb: string;
  kind: AssetKind;
  defaultMaterial: MaterialId;
  /** Default world-unit Y-height; placements may override. */
  defaultHeight: number;
  /** [width-x, depth-z] in world units; drives the minimap rectangle. */
  footprint: [number, number];
  /** Short human label shown on the minimap. */
  label: string;
};

export const CATALOG = {
  apartment: {
    glb: "/models/building-apartment.glb",
    kind: "building",
    defaultMaterial: "bricks",
    defaultHeight: 14,
    footprint: [20, 20],
    label: "apt",
  },
  mansion: {
    glb: "/models/building-mansion.glb",
    kind: "building",
    defaultMaterial: "plaster",
    defaultHeight: 13,
    footprint: [20, 20],
    label: "mansion",
  },
  multistory: {
    glb: "/models/building-multistory.glb",
    kind: "building",
    defaultMaterial: "concrete",
    defaultHeight: 17,
    footprint: [22, 22],
    label: "tower",
  },
  facade: {
    glb: "/models/building-facade.glb",
    kind: "building",
    defaultMaterial: "concrete",
    defaultHeight: 22,
    footprint: [24, 12],
    label: "facade",
  },
  rubble: {
    glb: "/models/rubble-large.glb",
    kind: "rubble",
    defaultMaterial: "concrete",
    defaultHeight: 1.5,
    footprint: [2.5, 2.5],
    label: "rubble",
  },
  taxi: {
    glb: "/models/vehicle-taxi.glb",
    kind: "vehicle",
    defaultMaterial: "metal",
    defaultHeight: 1.5,
    footprint: [4, 2.2],
    label: "veh",
  },
  sign: {
    glb: "/models/street-signs.glb",
    kind: "sign",
    defaultMaterial: "metal",
    defaultHeight: 2.5,
    footprint: [1, 1],
    label: "sign",
  },
} as const satisfies Record<string, AssetCatalogEntry>;

export type AssetId = keyof typeof CATALOG;

// ============================================================================
// 3. REGIONS
// ============================================================================
// Named zones used for (a) minimap context, (b) constraint validation.
// `exclusionZone: true` means no physical placement may overlap.

export type RegionKind = "alley" | "plaza" | "layer";

export type Region = {
  id: string;
  kind: RegionKind;
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
  exclusionZone?: boolean;
  purpose: string;
};

export const REGIONS: Region[] = [
  {
    id: "centralAlley",
    kind: "alley",
    bounds: { xMin: -2, xMax: 3, zMin: -32, zMax: -6 },
    exclusionZone: true,
    purpose: "Drone/dog/FPV camera corridor — geometry-free",
  },
  {
    id: "heroLayer",
    kind: "layer",
    bounds: { xMin: -25, xMax: 25, zMin: -30, zMax: -8 },
    purpose: "Camera passes between these buildings",
  },
  {
    id: "midLayer",
    kind: "layer",
    bounds: { xMin: -32, xMax: 32, zMin: -52, zMax: -30 },
    purpose: "Backdrop, mid-distance",
  },
];

// Tightened to the actual extent of placements + camera path (after the
// far-layer was removed). Keeps the minimap zoomed in on real content.
export const SCENE_BOUNDS = {
  xMin: -32,
  xMax: 32,
  zMin: -55,
  zMax: 30,
} as const;

// ============================================================================
// 4. PLACEMENTS
// ============================================================================
// One short row per object. Catalog supplies defaults; override only what
// the specific instance needs different (height, material, tint).
//
// Coordinate stability: every entry tagged "// LOCKED" is referenced by
// waypoints in missionTimeline.ts. Move at your own risk.

export type Placement = {
  id: string;
  asset: AssetId;
  at: [number, number, number];
  /** Y-rotation in radians. */
  yaw?: number;
  /** Small Z-tilt for fallen-over assets. */
  tilt?: number;
  /** Overrides CATALOG[asset].defaultHeight. */
  height?: number;
  /** Overrides CATALOG[asset].defaultMaterial. */
  material?: MaterialId;
  tint?: string;
  /** Optional logical grouping for the minimap. */
  region?: string;
};

export const PLACEMENTS: Placement[] = [
  // === HERO LAYER — camera passes between (LOCKED for waypoints) ============
  { id: "hero-apt-L",        asset: "apartment",  at: [-12, 0, -16], yaw:  0.20, tint: "#a89888", region: "heroLayer" }, // LOCKED
  { id: "hero-mansion-R",    asset: "mansion",    at: [ 13, 0, -20], yaw: -0.55, tint: "#9a8e80", region: "heroLayer" }, // LOCKED

  // === MID LAYER — backdrop within fog falloff (LOCKED waypoints + 2 fills) =
  { id: "mid-multistory-L",  asset: "multistory", at: [-22, 0, -36], yaw:  0.30,                                       tint: "#8a8278", region: "midLayer" }, // LOCKED
  { id: "mid-multistory-W",  asset: "multistory", at: [-16, 0, -34], yaw: -0.80, height: 12, material: "bricks",        tint: "#a08a78", region: "midLayer" }, // LOCKED
  { id: "mid-mansion-R",     asset: "mansion",    at: [ 22, 0, -38], yaw: -0.40, height: 15, material: "bricks",        tint: "#9c8a78", region: "midLayer" },
  { id: "mid-apt-center",    asset: "apartment",  at: [  4, 0, -42], yaw:  1.50,             material: "concrete",      tint: "#8c8478", region: "midLayer" }, // LOCKED
  { id: "mid-mansion-deep-W",asset: "mansion",    at: [-30, 0, -28], yaw:  0.70, height: 16,                            tint: "#8c8278", region: "midLayer" },

  // === VEHICLES — three in the plaza, one in the apartment ruin =============
  { id: "veh-taxi-E",        asset: "taxi", at: [  9, 0,   1], yaw: -0.7,                          tint: "#a08070" },
  { id: "veh-taxi-W",        asset: "taxi", at: [ -6, 0,  -8], yaw:  2.2, tilt: 0.15,              tint: "#8c7060" },
  { id: "veh-crashed-NW",    asset: "taxi", at: [ -9, 0, -10], yaw:  0.6, tilt: 0.70, height: 1.4, tint: "#7a6050" },
  { id: "veh-mid-W",         asset: "taxi", at: [ -7, 0, -38], yaw: -0.3,                          tint: "#7a6454", region: "midLayer" },

  // === SIGNS — along the alley edges, near the survivors ====================
  { id: "sign-E",            asset: "sign", at: [  5, 0, -10], yaw:  0.3, height: 2.8, tint: "#9a8478" },
  { id: "sign-deep-W",       asset: "sign", at: [ -3, 0, -18], yaw: -0.2, height: 2.4, tint: "#7c6a52" },
  { id: "sign-mid-E",        asset: "sign", at: [  8, 0, -24], yaw:  1.1, height: 2.2, tint: "#7a6c54" },
  { id: "sign-T02",          asset: "sign", at: [  4, 0, -26], yaw:  1.5, height: 2.2, tint: "#7a6c5a" },

  // === RUBBLE — concentrated in the hero zone z∈[-30, 0] ====================
  { id: "rubble-NE",            asset: "rubble", at: [  6, 0, -16], yaw: -0.4, height: 1.8,                              tint: "#928678" },
  { id: "rubble-far-W",         asset: "rubble", at: [ -7, 0, -22], yaw:  2.1, height: 1.6,                              tint: "#827a6c" },
  { id: "rubble-huge-NW",       asset: "rubble", at: [ -7, 0, -10], yaw:  1.4,             height: 3.0,                  tint: "#7e7464" },
  { id: "rubble-survivor-W",    asset: "rubble", at: [ -4, 0, -20], yaw:  0.7, height: 1.5,                              tint: "#928678" },
  { id: "rubble-survivor-E",    asset: "rubble", at: [  5, 0, -25], yaw: -1.0, height: 1.3,                              tint: "#8c8070" },
  { id: "rubble-corner-mansion",asset: "rubble", at: [  8, 0, -28], yaw:  0.5, height: 1.5,                              tint: "#928678" },
  { id: "rubble-deep-W",        asset: "rubble", at: [-14, 0, -30], yaw:  0.9, height: 1.6,                              tint: "#867a6e" },
  { id: "rubble-mid-W",         asset: "rubble", at: [-13, 0, -36], yaw:  1.4, height: 1.3,                              tint: "#776a5c", region: "midLayer" },
];

// ============================================================================
// 5. API — resolve, query, validate
// ============================================================================

export type ResolvedPlacement = {
  id: string;
  glb: string;
  kind: AssetKind;
  position: [number, number, number];
  rotation: [number, number, number];
  height: number;
  materialId: MaterialId;
  tint?: string;
  footprint: [number, number];
  label: string;
  region?: string;
};

export function resolvePlacement(p: Placement): ResolvedPlacement {
  const c = CATALOG[p.asset];
  return {
    id: p.id,
    glb: c.glb,
    kind: c.kind,
    position: p.at,
    rotation: [0, p.yaw ?? 0, p.tilt ?? 0],
    height: p.height ?? c.defaultHeight,
    materialId: p.material ?? c.defaultMaterial,
    tint: p.tint,
    footprint: c.footprint,
    label: c.label,
    region: p.region,
  };
}

let _resolved: ResolvedPlacement[] | null = null;
export function getResolvedPlacements(): ResolvedPlacement[] {
  if (!_resolved) _resolved = PLACEMENTS.map(resolvePlacement);
  return _resolved;
}

let _glbs: string[] | null = null;
/** Unique GLB paths — feed to useGLTF.preload. */
export function getPreloadGlbs(): string[] {
  if (!_glbs) {
    _glbs = Array.from(new Set(Object.values(CATALOG).map((c) => c.glb)));
  }
  return _glbs;
}

// Re-export canonical survivor positions so the minimap doesn't duplicate.
export { SURVIVORS };

// ----- Validation (dev only) -----
// Warns when (a) a placement's footprint intrudes on an exclusion zone, or
// (b) a survivor sits outside the alley. console.warn rather than throw —
// half-unit straddles shouldn't break the dev loop.
function rectsOverlap(
  a: { cx: number; cz: number; w: number; d: number },
  b: { xMin: number; xMax: number; zMin: number; zMax: number },
): boolean {
  const ax0 = a.cx - a.w / 2;
  const ax1 = a.cx + a.w / 2;
  const az0 = a.cz - a.d / 2;
  const az1 = a.cz + a.d / 2;
  return ax1 > b.xMin && ax0 < b.xMax && az1 > b.zMin && az0 < b.zMax;
}

export function validateSceneMap(): string[] {
  const issues: string[] = [];
  const exclusions = REGIONS.filter((r) => r.exclusionZone);

  for (const p of getResolvedPlacements()) {
    for (const r of exclusions) {
      if (
        rectsOverlap(
          {
            cx: p.position[0],
            cz: p.position[2],
            w: p.footprint[0],
            d: p.footprint[1],
          },
          r.bounds,
        )
      ) {
        issues.push(`placement "${p.id}" overlaps exclusion zone "${r.id}"`);
      }
    }
  }

  const alley = REGIONS.find((r) => r.id === "centralAlley")?.bounds;
  if (alley) {
    for (const s of SURVIVORS) {
      const inside =
        s.position[0] >= alley.xMin &&
        s.position[0] <= alley.xMax &&
        s.position[2] >= alley.zMin &&
        s.position[2] <= alley.zMax;
      if (!inside) issues.push(`survivor "${s.id}" outside the alley`);
    }
  }

  return issues;
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  const issues = validateSceneMap();
  if (issues.length) {
    console.warn(
      `[sceneMap] ${issues.length} layout issue(s):\n  - ${issues.join("\n  - ")}`,
    );
  }
}
