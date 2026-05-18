import { TacticalRoadNetwork } from "../../road-network.js";
import { currentScenePreset, getPresetBasemap } from "../config/presets.js";

/* Tactical basemap — MapLibre + PMTiles (Firenze), aligned with demo_player */
export const TACTICAL_PMTILES_REMOTE = "https://pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles";
export const GEO_BOUNDS_300M = {
  label: "Firenze Centro 300m x 300m",
  southWest: [43.76825, 11.25393],
  northEast: [43.77095, 11.25767],
};

export function resolveTacticalPmtilesUrl() {
  try {
    const o = window.location?.origin;
    if (o && o !== "null" && window.location?.protocol !== "file:") {
      return `${o}/api/pmtiles-proxy`;
    }
  } catch {
    /* ignore */
  }
  return TACTICAL_PMTILES_REMOTE;
}

export let tacticalPmtilesUrl = resolveTacticalPmtilesUrl();
export let tacticalBaseMap = null;
export let tacticalBaseMapReady = false;
let tacticalPmtilesProtoInstalled = false;
let tacticalPmtilesProtocol = null;
export let tacticalRoadSegments = [];
export let tacticalRoadNetworkReady = false;
export let tacticalBuildingFootprints = [];
export let tacticalBuildingsReady = false;

let tacticalGridDimsGetter = () => [30, 30];

export function registerTacticalGridDims(getter) {
  tacticalGridDimsGetter = getter;
}

export function getTacticalGridDims() {
  return tacticalGridDimsGetter();
}

export function tacticalLngLatToGrid(lng, lat) {
  const [cols, rows] = getTacticalGridDims();
  const west = GEO_BOUNDS_300M.southWest[1];
  const east = GEO_BOUNDS_300M.northEast[1];
  const north = GEO_BOUNDS_300M.northEast[0];
  const south = GEO_BOUNDS_300M.southWest[0];
  return {
    x: ((lng - west) / (east - west)) * cols,
    y: ((north - lat) / (north - south)) * rows,
  };
}

export function syncTacticalBasemapSize() {
  const el = document.getElementById("tacticalBasemap");
  const canvas = document.querySelector("#simCanvas");
  if (!el || !canvas) return;
  const w = Math.max(1, Math.floor(canvas.clientWidth));
  const h = Math.max(1, Math.floor(canvas.clientHeight));
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  if (tacticalBaseMap) {
    tacticalBaseMap.resize();
    tacticalBaseMap.fitBounds(
      [
        [GEO_BOUNDS_300M.southWest[1], GEO_BOUNDS_300M.southWest[0]],
        [GEO_BOUNDS_300M.northEast[1], GEO_BOUNDS_300M.northEast[0]],
      ],
      { padding: 0, duration: 0 },
    );
  }
}

/** Protomaps-hosted glyph PBFs (same ecosystem as default Firenze PMTiles); avoids flaky demo CDN. */
const TACTICAL_GLYPHS_URL =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";

export function makeTacticalBasemapStyle(presetKey) {
  const pk = presetKey || currentScenePreset || "urban_quake";
  const b = getPresetBasemap(pk);
  return {
    version: 8,
    glyphs: TACTICAL_GLYPHS_URL,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${tacticalPmtilesUrl}`,
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "pm-mask",
        source: "protomaps",
        "source-layer": "mask",
        type: "fill",
        paint: { "fill-color": b.mask },
      },
      {
        id: "pm-earth",
        source: "protomaps",
        "source-layer": "earth",
        type: "fill",
        paint: { "fill-color": b.earth },
      },
      {
        id: "pm-water",
        source: "protomaps",
        "source-layer": "water",
        type: "fill",
        paint: { "fill-color": b.water, "fill-opacity": b.waterOpacity ?? 0.85 },
      },
      {
        id: "pm-landuse",
        source: "protomaps",
        "source-layer": "landuse",
        type: "fill",
        paint: { "fill-color": b.landuse, "fill-opacity": b.landuseOpacity ?? 0.72 },
      },
      {
        id: "pm-buildings",
        source: "protomaps",
        "source-layer": "buildings",
        type: "fill",
        paint: {
          "fill-color": b.buildings.fill,
          "fill-opacity": b.buildings.opacity ?? 0.92,
          "fill-outline-color": b.buildings.outline,
        },
      },
      {
        id: "pm-roads",
        source: "protomaps",
        "source-layer": "roads",
        type: "line",
        paint: {
          "line-color": b.roads.color,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 3.2, 18, 5.6],
          "line-opacity": b.roads.opacity ?? 0.82,
        },
      },
      {
        id: "pm-road-labels",
        source: "protomaps",
        "source-layer": "roads",
        type: "symbol",
        filter: ["has", "name"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 16, 11, 18, 13],
          "text-padding": 2,
        },
        paint: {
          "text-color": b.roadLabels.color,
          "text-halo-color": b.roadLabels.halo,
          "text-halo-width": 1.2,
          "text-opacity": b.roadLabels.opacity ?? 0.76,
        },
      },
    ],
  };
}

export function applyTacticalBasemapStylePreset(presetKey) {
  const b = getPresetBasemap(presetKey);
  if (!tacticalBaseMap || !tacticalBaseMapReady) return;
  try {
    tacticalBaseMap.setPaintProperty("pm-mask", "fill-color", b.mask);
    tacticalBaseMap.setPaintProperty("pm-earth", "fill-color", b.earth);
    tacticalBaseMap.setPaintProperty("pm-water", "fill-color", b.water);
    tacticalBaseMap.setPaintProperty("pm-water", "fill-opacity", b.waterOpacity ?? 0.85);
    tacticalBaseMap.setPaintProperty("pm-landuse", "fill-color", b.landuse);
    tacticalBaseMap.setPaintProperty("pm-landuse", "fill-opacity", b.landuseOpacity ?? 0.72);
    tacticalBaseMap.setPaintProperty("pm-buildings", "fill-color", b.buildings.fill);
    tacticalBaseMap.setPaintProperty("pm-buildings", "fill-outline-color", b.buildings.outline);
    tacticalBaseMap.setPaintProperty("pm-buildings", "fill-opacity", b.buildings.opacity ?? 0.92);
    tacticalBaseMap.setPaintProperty("pm-roads", "line-color", b.roads.color);
    tacticalBaseMap.setPaintProperty("pm-roads", "line-opacity", b.roads.opacity ?? 0.82);
    tacticalBaseMap.setPaintProperty("pm-road-labels", "text-color", b.roadLabels.color);
    tacticalBaseMap.setPaintProperty("pm-road-labels", "text-halo-color", b.roadLabels.halo);
    tacticalBaseMap.setPaintProperty("pm-road-labels", "text-opacity", b.roadLabels.opacity ?? 0.76);
  } catch (err) {
    console.warn("[tactical basemap] preset paint failed:", err);
  }
}

export function flattenTacticalRoadCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

export function tacticalSegmentInMap(a, b) {
  const [cols, rows] = getTacticalGridDims();
  const margin = 1;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX >= -margin && minX <= cols + margin && maxY >= -margin && minY <= rows + margin;
}

export function scaleRoadSegmentsFromExport(data, toCols, toRows) {
  if (!data?.segments?.length) return [];
  const from = data.mapSize || [30, 30];
  const fc = Math.max(1, from[0]);
  const fr = Math.max(1, from[1]);
  const sx = toCols / fc;
  const sy = toRows / fr;
  return data.segments.map((seg) => ({
    a: { x: seg.a.x * sx, y: seg.a.y * sy },
    b: { x: seg.b.x * sx, y: seg.b.y * sy },
  }));
}

function flattenTacticalPolygonCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates[0] || []];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((poly) => poly[0] || []);
  }
  return [];
}

function polygonAreaAndCentroid(ring) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  if (ring.length < 3) return { area: 0, centroid: [0, 0] };
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = xj * yi - xi * yj;
    twiceArea += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  const area = Math.abs(twiceArea) * 0.5;
  if (area < 1e-9) {
    const sx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const sy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return { area: 0, centroid: [sx, sy] };
  }
  return { area, centroid: [cx / (3 * twiceArea), cy / (3 * twiceArea)] };
}

function polygonBounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function simplifyRing(ring, maxVerts) {
  if (ring.length <= maxVerts) return ring;
  const stride = Math.ceil(ring.length / maxVerts);
  const out = [];
  for (let i = 0; i < ring.length; i += stride) out.push(ring[i]);
  if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
  return out;
}

/** @param {() => void} [onAfter] — e.g. refresh UGV routing from live segments */
export function rebuildTacticalRoadNetwork(onAfter) {
  if (!tacticalBaseMap || !tacticalBaseMapReady) return;
  let features = [];
  try {
    features = tacticalBaseMap.querySourceFeatures("protomaps", { sourceLayer: "roads" });
  } catch (err) {
    console.warn("[tactical basemap] road query failed:", err);
    return;
  }
  const segments = [];
  for (const feature of features) {
    for (const line of flattenTacticalRoadCoords(feature.geometry)) {
      for (let i = 1; i < line.length; i += 1) {
        const a = tacticalLngLatToGrid(line[i - 1][0], line[i - 1][1]);
        const b = tacticalLngLatToGrid(line[i][0], line[i][1]);
        if (tacticalSegmentInMap(a, b)) segments.push({ a, b });
      }
    }
  }
  if (segments.length) {
    tacticalRoadSegments = segments;
    tacticalRoadNetworkReady = true;
    window.__arcSimulationRoadSegments = tacticalRoadSegments;
  }
  if (onAfter) onAfter();
}

/** @param {() => void} [onReady] */
export function rebuildTacticalBuildingFootprints(onReady) {
  if (!tacticalBaseMap || !tacticalBaseMapReady) return;
  let features = [];
  try {
    features = tacticalBaseMap.querySourceFeatures("protomaps", { sourceLayer: "buildings" });
  } catch (err) {
    console.warn("[tactical basemap] building query failed:", err);
    return;
  }
  const seen = new Set();
  const out = [];
  const [cols, rows] = getTacticalGridDims();
  for (const feature of features) {
    const fid = feature.id ?? feature.properties?.["@id"] ?? feature.properties?.id;
    const key = fid != null ? String(fid) : `${feature.geometry?.type}:${JSON.stringify(feature.geometry?.coordinates?.[0]?.[0] || [])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rings = flattenTacticalPolygonCoords(feature.geometry);
    for (const ringLngLat of rings) {
      if (!ringLngLat || ringLngLat.length < 3) continue;
      const gridRing = ringLngLat.map((c) => {
        const p = tacticalLngLatToGrid(c[0], c[1]);
        return [p.x, p.y];
      });
      const bounds = polygonBounds(gridRing);
      if (bounds.maxX < -1 || bounds.minX > cols + 1) continue;
      if (bounds.maxY < -1 || bounds.minY > rows + 1) continue;
      const simplified = simplifyRing(gridRing, 16);
      const { area, centroid } = polygonAreaAndCentroid(simplified);
      if (area < 0.05) continue;
      out.push({
        id: `B${out.length + 1}`,
        polygon: simplified,
        centroid,
        area,
        bounds,
        damage: "intact",
      });
    }
  }
  if (out.length) {
    tacticalBuildingFootprints = out;
    tacticalBuildingsReady = true;
    if (onReady) onReady();
  }
}

function installTacticalPmtilesProtocol() {
  const ml = globalThis.maplibregl;
  const Pm = globalThis.pmtiles;
  if (!ml || !Pm) return;
  if (!tacticalPmtilesProtoInstalled) {
    tacticalPmtilesProtocol = new Pm.Protocol();
    ml.addProtocol("pmtiles", tacticalPmtilesProtocol.tile);
    tacticalPmtilesProtoInstalled = true;
  }
  tacticalPmtilesProtocol.add(new Pm.PMTiles(tacticalPmtilesUrl));
}

/**
 * @param {{ onIdle?: () => void }} options
 */
export function initTacticalBasemap(options = {}) {
  const ml = globalThis.maplibregl;
  const Pm = globalThis.pmtiles;
  if (tacticalBaseMap || !ml || !Pm) return;
  const mount = document.getElementById("tacticalBasemap");
  if (!mount) return;

  tacticalPmtilesUrl = resolveTacticalPmtilesUrl();
  try {
    installTacticalPmtilesProtocol();
    tacticalBaseMap = new ml.Map({
      container: mount,
      style: makeTacticalBasemapStyle(currentScenePreset),
      bounds: [
        [GEO_BOUNDS_300M.southWest[1], GEO_BOUNDS_300M.southWest[0]],
        [GEO_BOUNDS_300M.northEast[1], GEO_BOUNDS_300M.northEast[0]],
      ],
      fitBoundsOptions: { padding: 0, duration: 0 },
      interactive: false,
      attributionControl: false,
    });
    tacticalBaseMap.on("load", () => {
      tacticalBaseMapReady = true;
      tacticalBaseMap.fitBounds(
        [
          [GEO_BOUNDS_300M.southWest[1], GEO_BOUNDS_300M.southWest[0]],
          [GEO_BOUNDS_300M.northEast[1], GEO_BOUNDS_300M.northEast[0]],
        ],
        { padding: 0, duration: 0 },
      );
      syncTacticalBasemapSize();
      applyTacticalBasemapStylePreset(currentScenePreset);
    });
    tacticalBaseMap.on("idle", () => {
      if (options.onIdle) options.onIdle();
    });
    tacticalBaseMap.on("error", (e) => {
      console.warn("[tactical basemap] map error:", e?.error || e);
    });
  } catch (err) {
    console.warn("[tactical basemap] initialization failed:", err);
  }
}

export function wireTacticalBasemapResize() {
  const canvas = document.querySelector("#simCanvas");
  const frame = canvas?.closest(".canvas-frame");
  if (!frame || typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => syncTacticalBasemapSize());
  ro.observe(frame);
}
