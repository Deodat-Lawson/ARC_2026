import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { Tree, TreePreset } from "@dgreenheck/ez-tree";
import {
  PRESET_VISUAL,
  activePreset,
  currentScenePreset,
  setCurrentScenePreset,
} from "../../config/presets.js";
import { pointNearBuilding } from "../../sim/collision.js";
import { lerp } from "../../sim/math.js";
import { createAgentMesh, agentBaseAltitude } from "./fleet-agents-mesh.js";
import { loadInjuredSoldierPrototype, createInjuredSoldierInstance } from "./injured-soldier.js";
import {
  lerpAngleDeg,
  tacticalFpvAltitudeUrbanUnits,
  tacticalFpvEyeWorldPosition,
  tacticalFpvForwardVector,
  tacticalFpvHudAltUrbanGrid,
  tacticalFpvLookDistanceWorld,
  tacticalFpvPhaseSeed,
} from "./fleet-fpv-kit.js";
import {
  ui3d,
  bindWorld3dUi,
  povs,
  buildAgentSelector,
  teardownAgentSelector,
  currentTargetFor,
  currentTargetIdFor,
} from "./tactical-pov-shell.js";
import {
  urbanGridToWorldXZ,
  hash01,
  get3DTerrain,
  get3DRoads,
  get3DBuildings,
  computeRoadCells,
  cellDamageLevel,
  buildingProfile,
  buildingRenderFootprint,
  scenarioBuildingEntries,
  buildingAvoidanceRects,
} from "./urban-quake-scenario-grid.js";

export { buildingAvoidanceRects };

const ROAD_TEX_BASE = "/textures/road";
let _roadTextures = null;
function ensureRoadTextures() {
  if (_roadTextures) return _roadTextures;
  const loader = new THREE.TextureLoader();
  const load = (url, srgb = true) => {
    const t = loader.load(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  _roadTextures = {
    asphalt: load(`${ROAD_TEX_BASE}/asphalt.jpg`),
    pavement: load(`${ROAD_TEX_BASE}/pavement.jpg`),
    pavementBump: load(`${ROAD_TEX_BASE}/pavement-bump.jpg`, false),
    metal: load(`${ROAD_TEX_BASE}/metal.jpg`),
  };
  return _roadTextures;
}

function tiledClone(tex, repeatX, repeatY) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(repeatX, repeatY);
  return t;
}

export const world = {
  scene: null,
  visualPresetForAssets: "urban_quake",
  agentMeshes: new Map(),
  victimMeshes: new Map(),
  blockadeMeshes: new Map(),
  riskMeshes: new Map(),
  baseMesh: null,
  groundGrid: null,
  horizonSilhouette: null,
  perimeterBuildings: null,
  scenarioBuildingsGroup: null,
  roadsGroup: null,
  smokeSteps: [],
  fireGlows: [],
  brokenBranches: [],
  skyClouds: [],
  initialized: false,
};

function makeGradientSkyTexture(size = 512, stops = null) {
  const c = document.createElement("canvas");
  const width = 512;
  c.width = width;
  c.height = size;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, size);
  const use = stops && stops.length
    ? stops
    : [
        [0.0, "#08101a"],
        [0.45, "#1a1612"],
        [0.72, "#3a2418"],
        [0.88, "#5a3a22"],
        [1.0, "#1c1610"],
      ];
  for (const [t, color] of use) grad.addColorStop(t, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, width, size);

  // Layered ash-cloud streaks — soft horizontal bands of slightly-warmer dust
  // that break up the flat gradient and read as "smoke in the upper atmosphere."
  const cloudLayers = 8;
  for (let i = 0; i < cloudLayers; i += 1) {
    const cy = size * (0.15 + (i / cloudLayers) * 0.7 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.08);
    const ch = size * (0.04 + (Math.sin(i * 78.233) * 0.5 + 0.5) * 0.08);
    const cloudGrad = g.createLinearGradient(0, cy - ch, 0, cy + ch);
    const warm = i < 3 ? "rgba(80, 50, 35," : "rgba(60, 45, 38,";
    cloudGrad.addColorStop(0, `${warm} 0)`);
    cloudGrad.addColorStop(0.5, `${warm} ${0.18 + (Math.sin(i * 9.7) * 0.5 + 0.5) * 0.18})`);
    cloudGrad.addColorStop(1, `${warm} 0)`);
    g.fillStyle = cloudGrad;
    // Irregular horizontal patches so cloud bands aren't perfectly straight
    const patches = 5;
    for (let k = 0; k < patches; k += 1) {
      const x0 = (k / patches) * width + (Math.sin(i * 3 + k * 7) * 0.5 + 0.5) * (width / patches) * 0.5;
      const w = (width / patches) * (0.6 + (Math.sin(i * 5 + k * 11) * 0.5 + 0.5) * 0.8);
      g.fillRect(x0, cy - ch, w, ch * 2);
    }
  }

  // Faint warm horizon glow — uneven reddish smear at the bottom edge
  const horizonGrad = g.createLinearGradient(0, size * 0.78, 0, size);
  horizonGrad.addColorStop(0, "rgba(0,0,0,0)");
  horizonGrad.addColorStop(0.6, "rgba(110, 50, 25, 0.22)");
  horizonGrad.addColorStop(1, "rgba(140, 70, 35, 0.32)");
  g.fillStyle = horizonGrad;
  g.fillRect(0, size * 0.78, width, size * 0.22);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Slow-drifting volumetric clouds in the upper atmosphere — adds depth to the sky. */
function addSkyClouds(scene, cols, rows) {
  const clouds = [];
  const cx = cols / 2;
  const cz = rows / 2;
  const cloudCount = 14;
  for (let i = 0; i < cloudCount; i += 1) {
    const ang = (i / cloudCount) * Math.PI * 2 + Math.sin(i * 7.3) * 0.4;
    const dist = 26 + Math.sin(i * 11.7) * 6;
    const height = 14 + Math.sin(i * 4.2) * 6;
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(3.5 + Math.sin(i * 5.5) * 1.8, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0x2a2018,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        fog: false,
      })
    );
    cloud.position.set(cx + Math.cos(ang) * dist, height, cz + Math.sin(ang) * dist);
    cloud.scale.set(2.2 + Math.sin(i * 3.1) * 0.6, 0.55, 1.6 + Math.sin(i * 6.7) * 0.5);
    const baseOpacity = 0.18 + (Math.sin(i * 8.1) * 0.5 + 0.5) * 0.22;
    cloud.material.opacity = baseOpacity;
    cloud.material.color.setRGB(0.12 + Math.sin(i * 2.3) * 0.04, 0.09, 0.07);
    scene.add(cloud);
    clouds.push({ mesh: cloud, cx, cz, ang, dist, height, phase: i, baseOpacity });
  }
  return clouds;
}

function addTerrainPatches3D(scenario) {
  const terrain = get3DTerrain(scenario);
  if (!terrain.length) return;
  const palettes = {
    grass: { color: 0x2d4a25, roughness: 0.95, metalness: 0.02, emissive: 0x000000 },
    water: { color: 0x1c3550, roughness: 0.2, metalness: 0.5, emissive: 0x031530 },
    rubble: { color: 0x3d3a35, roughness: 0.98, metalness: 0.02, emissive: 0x000000 },
    plaza: { color: 0x3a4250, roughness: 0.92, metalness: 0.05, emissive: 0x000000 }
  };

  for (const patch of terrain) {
    const [px, py, pw, ph] = patch.footprint;
    const palette = palettes[patch.kind] || palettes.plaza;
    const mat = new THREE.MeshStandardMaterial({
      color: palette.color,
      roughness: palette.roughness,
      metalness: palette.metalness,
      emissive: palette.emissive,
      emissiveIntensity: patch.kind === "water" ? 0.3 : 0
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(px + pw / 2, 0.012, py + ph / 2);
    world.scene.add(mesh);
  }
}

function buildHorizonSilhouette(scenario) {
  const [cols, rows] = scenario.map.size;
  const cx = cols / 2;
  const cz = rows / 2;
  const baseRadius = Math.max(cols, rows) * 1.85;
  const silMat = new THREE.MeshBasicMaterial({
    color: 0x0a0d13,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    fog: true
  });
  const count = 56;
  const instMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), silMat, count);
  const dummy = new THREE.Object3D();
  const lit = new THREE.Color(0x201813);
  const dark = new THREE.Color(0x070a0f);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const gap = hash01(i, 0, 97) < 0.24;
    const r = baseRadius + hash01(i, 0, 91) * 18;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    const w = 1.2 + hash01(i, 0, 92) * 2.1;
    const d = 1.2 + hash01(i, 0, 93) * 2.1;
    const h = gap ? 0.01 : 0.8 + hash01(i, 0, 94) * 3.6;
    dummy.position.set(x, h / 2, z);
    dummy.rotation.set(0, angle + Math.PI / 2 + (hash01(i, 0, 95) - 0.5) * 0.5, 0);
    dummy.scale.set(gap ? 0.01 : w, h, gap ? 0.01 : d);
    dummy.updateMatrix();
    instMesh.setMatrixAt(i, dummy.matrix);
    instMesh.setColorAt(i, hash01(i, 0, 96) > 0.9 ? lit : dark);
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = "horizon-silhouette";
  group.add(instMesh);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4 + 0.1) * Math.PI * 2;
    const r = baseRadius + 9;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    const phase = i * 1.5;
    for (let p = 0; p < 6; p += 1) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(2.2 + p * 0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x1e1a17, transparent: true, opacity: 0.25 - p * 0.025, depthWrite: false, fog: true })
      );
      sphere.position.set(x + Math.sin(phase + p) * 1.2, 6 + p * 2.5, z + Math.cos(phase + p) * 1.2);
      group.add(sphere);
    }
  }
  world.scene.add(group);
  world.horizonSilhouette = group;
}

/** Ring of building GLB clones hugging the play-area perimeter so ground-level
 *  POVs (cars, rescuers) never see the world's edge. Uses the same building
 *  templates as the in-scene scenario buildings so the look stays consistent.
 *  Pure visual fill — never queried by sim or planner. */
function addPerimeterBuildings(scenario, templateMeta) {
  if (!templateMeta?.length || !world.scene) return;
  const [cols, rows] = scenario.map.size;

  if (world.perimeterBuildings) {
    world.scene.remove(world.perimeterBuildings);
    disposeObject(world.perimeterBuildings);
    world.perimeterBuildings = null;
  }

  // Single jittered row hugging each edge — no deep background.
  const innerMargin = 1.6;

  const placements = [];
  const placeAt = (x, z, saltBase) => {
    const w = 2.4 + hash01(x, z, saltBase + 1) * 2.4;
    const d = 2.4 + hash01(x, z, saltBase + 2) * 2.4;
    const h = 1.0 + hash01(x, z, saltBase + 4) * 1.2;  // 1.0 – 2.2u
    const yawSteps = Math.floor(hash01(x, z, saltBase + 5) * 4);
    placements.push({ x, z, w, d, h, yaw: yawSteps * (Math.PI / 2) });
  };

  // Scatter one row along each side. `side` 0..3 maps to N/S/W/E.
  const buildStrip = (side) => {
    const step = 3.6;
    let cursor;
    let end;
    let fixedAxis;
    let rowCoord;
    if (side === 0) {           // North edge: z < 0
      rowCoord = -innerMargin;
      fixedAxis = "z";
      cursor = -innerMargin;
      end = cols + innerMargin;
    } else if (side === 1) {    // South edge: z > rows
      rowCoord = rows + innerMargin;
      fixedAxis = "z";
      cursor = -innerMargin;
      end = cols + innerMargin;
    } else if (side === 2) {    // West edge: x < 0
      rowCoord = -innerMargin;
      fixedAxis = "x";
      cursor = -innerMargin;
      end = rows + innerMargin;
    } else {                    // East edge: x > cols
      rowCoord = cols + innerMargin;
      fixedAxis = "x";
      cursor = -innerMargin;
      end = rows + innerMargin;
    }
    let i = 0;
    while (cursor < end) {
      const jitter = (hash01(i, side, 411) - 0.5) * 1.0;
      const x = fixedAxis === "x" ? rowCoord + (hash01(i, side, 421) - 0.5) * 1.0
                                  : cursor + jitter;
      const z = fixedAxis === "z" ? rowCoord + (hash01(i, side, 422) - 0.5) * 1.0
                                  : cursor + jitter;
      const gap = hash01(i, side, 430) < 0.10;
      if (!gap) placeAt(x, z, 500 + side * 7);
      cursor += step + hash01(i, side, 440) * 1.0;
      i += 1;
    }
  };

  for (let side = 0; side < 4; side += 1) buildStrip(side);

  for (const e of placements) {
    e.templateIndex = Math.floor(hash01(e.x, e.z, 611) * templateMeta.length)
      % templateMeta.length;
  }
  const group = placeBuildingsInstanced("perimeter-buildings", templateMeta, placements);
  world.scene.add(group);
  world.perimeterBuildings = group;
}

function buildRoads3D(scenario) {
  const roads = get3DRoads(scenario);
  if (!roads.length) return;

  const tex = ensureRoadTextures();
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x586173, roughness: 0.85, metalness: 0.05 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffe44d, emissive: 0xffe44d, emissiveIntensity: 0.45, roughness: 0.6 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xd6dde4, emissive: 0xd6dde4, emissiveIntensity: 0.18, roughness: 0.7 });

  const group = new THREE.Group();
  group.name = "roads3d";

  for (const road of roads) {
    const isMain = road.kind === "main";
    const width = isMain ? 1.0 : 0.7;
    const pts = road.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const ax = a[0] + 0.5;
      const az = a[1] + 0.5;
      const bx = b[0] + 0.5;
      const bz = b[1] + 0.5;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const yaw = Math.atan2(dz, dx);

      const segAsphaltMat = new THREE.MeshStandardMaterial({
        map: tiledClone(tex.asphalt, Math.max(1, len / 1.8), Math.max(1, width / 1.8)),
        color: 0xb8bcc4,
        roughness: 0.92,
        metalness: 0.06,
      });
      const asphalt = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.03, width), segAsphaltMat);
      asphalt.position.set(cx, 0.018, cz);
      asphalt.rotation.y = -yaw;
      group.add(asphalt);

      const perpX = -dz / len;
      const perpZ = dx / len;
      const curbW = 0.08;
      const curbH = 0.07;
      const curbOffset = width / 2 + curbW / 2;
      for (const side of [-1, 1]) {
        const curb = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, curbH, curbW), curbMat);
        curb.position.set(cx + perpX * curbOffset * side, curbH / 2 + 0.005, cz + perpZ * curbOffset * side);
        curb.rotation.y = -yaw;
        group.add(curb);
      }

      if (isMain) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, 0.004, 0.06), yellowMat);
        stripe.position.set(cx, 0.038, cz);
        stripe.rotation.y = -yaw;
        group.add(stripe);
      } else {
        const dashLen = 0.45;
        const gapLen = 0.5;
        const step = dashLen + gapLen;
        const count = Math.max(1, Math.floor(len / step));
        const total = count * step - gapLen;
        let pos = -total / 2 + dashLen / 2;
        for (let k = 0; k < count; k += 1) {
          const dash = new THREE.Mesh(new THREE.BoxGeometry(dashLen, 0.004, 0.045), whiteMat);
          dash.position.set(cx + (dx / len) * pos, 0.038, cz + (dz / len) * pos);
          dash.rotation.y = -yaw;
          group.add(dash);
          pos += step;
        }
      }
    }
  }

  world.scene.add(group);
  world.roadsGroup = group;
}

function addCityGroundDetail(scenario) {
  const roads = get3DRoads(scenario);
  if (!roads.length) return;

  const group = new THREE.Group();
  group.name = "city-ground-detail";
  const tex = ensureRoadTextures();
  const crosswalkMat = new THREE.MeshStandardMaterial({ color: 0xc8d1d8, roughness: 0.88, metalness: 0.02, emissive: 0xc8d1d8, emissiveIntensity: 0.06 });
  const hLines = new Set();
  const vLines = new Set();

  for (const road of roads) {
    const isMain = road.kind === "main";
    const width = isMain ? 1.0 : 0.7;
    const sidewalkW = isMain ? 0.25 : 0.18;
    const pts = road.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a[1] === b[1]) hLines.add(a[1]);
      if (a[0] === b[0]) vLines.add(a[0]);

      const ax = a[0] + 0.5;
      const az = a[1] + 0.5;
      const bx = b[0] + 0.5;
      const bz = b[1] + 0.5;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const yaw = Math.atan2(dz, dx);
      const perpX = -dz / len;
      const perpZ = dx / len;
      const offset = width / 2 + 0.11 + sidewalkW / 2;

      for (const side of [-1, 1]) {
        const segWalkMat = new THREE.MeshStandardMaterial({
          map: tiledClone(tex.pavement, Math.max(1, len / 0.6), 1),
          bumpMap: tiledClone(tex.pavementBump, Math.max(1, len / 0.6), 1),
          bumpScale: 0.05,
          color: 0xc8c0b2,
          roughness: 0.9,
          metalness: 0.04,
        });
        const walk = new THREE.Mesh(new THREE.BoxGeometry(len + 0.04, 0.025, sidewalkW), segWalkMat);
        walk.position.set(cx + perpX * offset * side, 0.018, cz + perpZ * offset * side);
        walk.rotation.y = -yaw;
        group.add(walk);
      }
    }
  }

  for (const y of hLines) {
    for (const x of vLines) {
      if (hash01(x, y, 240) < 0.25) continue;
      for (let i = -2; i <= 2; i += 1) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.006, 0.62), crosswalkMat);
        stripe.position.set(x + 0.5 + i * 0.15, 0.042, y + 0.5);
        group.add(stripe);
      }
    }
  }

  world.scene.add(group);
}

function nearestRiskKind(cellX, cellY, riskZones) {
  let best = { damage: 0, kind: null };
  for (const z of riskZones || []) {
    const dx = cellX - z.center[0];
    const dy = cellY - z.center[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    const reach = Math.max(0.01, z.radius + 1.5);
    if (d > reach) continue;
    const damage = Math.max(0, 1 - d / reach);
    if (damage > best.damage) best = { damage, kind: z.type };
  }
  return best;
}

function addBuildingRubble(group, footprint, damage, rubbleMat) {
  if (damage < 0.28) return;
  const [x, y, w, d] = footprint;
  const count = Math.min(5, Math.max(2, Math.floor(w * d * (1 + damage))));
  for (let i = 0; i < count; i += 1) {
    const sideBias = hash01(x + i, y, 170);
    const rx = x + hash01(x + i, y, 171) * w + (sideBias < 0.25 ? -0.18 : sideBias > 0.75 ? 0.18 : 0);
    const rz = y + hash01(x, y + i, 172) * d + (sideBias > 0.35 && sideBias < 0.6 ? -0.18 : sideBias > 0.6 && sideBias < 0.85 ? 0.18 : 0);
    const rw = 0.08 + hash01(rx, rz, 173) * 0.22;
    const rh = 0.04 + hash01(rx, rz, 174) * 0.14;
    const rd = 0.08 + hash01(rx, rz, 175) * 0.22;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rd), rubbleMat);
    chunk.position.set(rx, rh / 2 + 0.035, rz);
    chunk.rotation.set((hash01(rx, rz, 176) - 0.5) * 0.8, hash01(rx, rz, 177) * Math.PI * 2, (hash01(rx, rz, 178) - 0.5) * 0.8);
    group.add(chunk);
  }
}

/** Scatter concrete chunks, stone clusters, and rubble piles along every road
 *  segment so the streets read as post-earthquake instead of clean asphalt. */
function addRoadDebris(scenario, rubbleMat, rubbleGlbSrc) {
  const roads = get3DRoads(scenario);
  if (!roads.length || !rubbleMat) return;

  const riskZones = scenario.map.risk_zones || [];
  const [bxBase, byBase] = scenario.map.base || [-99, -99];
  const baseCx = bxBase + 0.5;
  const baseCz = byBase + 0.5;

  // Collect placements; build all chunks/stones as InstancedMeshes (one draw call each).
  // Per ~30u-long road segment at step 0.22 that's ~135 spawn rolls, ~80% chance to place,
  // so thousands of individual debris meshes on a typical scenario before instancing.
  const chunks = []; // { px, pz, w, h, d, rx, ry, rz }
  const stones = []; // { px, py, pz, s, rx, ry, rz }
  const piles = []; // { px, pz, targetSize, yaw }

  for (const road of roads) {
    const isMain = road.kind === "main";
    const width = isMain ? 1.0 : 0.7;
    const pts = road.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const ax = a[0] + 0.5;
      const az = a[1] + 0.5;
      const bx = b[0] + 0.5;
      const bz = b[1] + 0.5;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      const dirX = dx / len;
      const dirZ = dz / len;
      const perpX = -dirZ;
      const perpZ = dirX;

      const step = 0.22;
      const stops = Math.max(1, Math.floor(len / step));
      for (let s = 0; s <= stops; s += 1) {
        const t = s / Math.max(1, stops);
        const sx = ax + dx * t;
        const sz = az + dz * t;
        const cellX = Math.floor(sx);
        const cellY = Math.floor(sz);
        const damage = cellDamageLevel(cellX, cellY, riskZones);

        const placeProb = 0.75 + damage * 0.25;
        if (hash01(sx, sz, 380) > placeProb) continue;

        const dxBase = sx - baseCx;
        const dzBase = sz - baseCz;
        if (dxBase * dxBase + dzBase * dzBase < 1.0) continue;

        const laneRoll = hash01(sx, sz, 381);
        let lateral;
        if (laneRoll < 0.25) lateral = (hash01(sx, sz, 382) - 0.5) * width * 0.6;
        else if (laneRoll < 0.7) lateral = (width / 2 + 0.04) * (hash01(sx, sz, 383) > 0.5 ? 1 : -1);
        else lateral = (width / 2 + 0.18) * (hash01(sx, sz, 384) > 0.5 ? 1 : -1);

        const px = sx + perpX * lateral + (hash01(sx, sz, 385) - 0.5) * 0.08;
        const pz = sz + perpZ * lateral + (hash01(sx, sz, 386) - 0.5) * 0.08;

        const variantRoll = hash01(sx, sz, 387);

        if (variantRoll < 0.55) {
          const rh = 0.04 + hash01(sx, sz, 389) * 0.08;
          chunks.push({
            px, pz,
            w: 0.06 + hash01(sx, sz, 388) * 0.12,
            h: rh,
            d: 0.06 + hash01(sx, sz, 390) * 0.12,
            py: rh / 2 + 0.04,
            rx: (hash01(sx, sz, 391) - 0.5) * 0.8,
            ry: hash01(sx, sz, 392) * Math.PI * 2,
            rz: (hash01(sx, sz, 393) - 0.5) * 0.8,
          });
        } else if (variantRoll < 0.85) {
          const clusterCount = 3 + Math.floor(hash01(sx, sz, 394) * 2);
          for (let k = 0; k < clusterCount; k += 1) {
            const ox = (hash01(sx + k, sz, 395) - 0.5) * 0.22;
            const oz = (hash01(sx, sz + k, 396) - 0.5) * 0.22;
            // Original code picked between 0.06u and 0.085u dodecahedra. Use a single 0.085u
            // unit geometry and scale per-instance so we can collapse into one InstancedMesh.
            const sizeMul = hash01(sx + k, sz + k, 397) > 0.5 ? 1.0 : 0.06 / 0.085;
            const stoneScale = (0.7 + hash01(sx + k, sz - k, 398) * 0.6) * sizeMul;
            stones.push({
              px: px + ox,
              py: 0.04 + hash01(sx + k, sz + k, 399) * 0.03,
              pz: pz + oz,
              s: stoneScale,
              rx: hash01(sx + k, sz, 400) * Math.PI,
              ry: hash01(sx, sz + k, 401) * Math.PI * 2,
              rz: hash01(sx + k, sz + k, 402) * Math.PI,
            });
          }
        } else if (rubbleGlbSrc) {
          const sideSign = lateral === 0 ? (hash01(sx, sz, 403) > 0.5 ? 1 : -1) : Math.sign(lateral);
          piles.push({
            px: sx + perpX * (width / 2 + 0.05) * sideSign,
            pz: sz + perpZ * (width / 2 + 0.05) * sideSign,
            targetSize: 0.18 + hash01(sx, sz, 404) * 0.1,
            yaw: hash01(sx, sz, 405) * Math.PI * 2,
          });
        }
      }
    }
  }

  const group = new THREE.Group();
  group.name = "road-debris";
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpE = new THREE.Euler();

  if (chunks.length) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const inst = new THREE.InstancedMesh(unitBox, rubbleMat, chunks.length);
    inst.frustumCulled = false;
    for (let i = 0; i < chunks.length; i += 1) {
      const c = chunks[i];
      tmpV.set(c.px, c.py, c.pz);
      tmpE.set(c.rx, c.ry, c.rz, "XYZ");
      tmpQ.setFromEuler(tmpE);
      tmpS.set(c.w, c.h, c.d);
      tmpM.compose(tmpV, tmpQ, tmpS);
      inst.setMatrixAt(i, tmpM);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  if (stones.length) {
    const unitStone = new THREE.DodecahedronGeometry(0.085, 0);
    const inst = new THREE.InstancedMesh(unitStone, rubbleMat, stones.length);
    inst.frustumCulled = false;
    for (let i = 0; i < stones.length; i += 1) {
      const st = stones[i];
      tmpV.set(st.px, st.py, st.pz);
      tmpE.set(st.rx, st.ry, st.rz, "XYZ");
      tmpQ.setFromEuler(tmpE);
      tmpS.set(st.s, st.s, st.s);
      tmpM.compose(tmpV, tmpQ, tmpS);
      inst.setMatrixAt(i, tmpM);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // Large rubble piles stay as GLB clones — they're a small fraction (~5% of debris) but
  // collapsing them too would require a uniform-scale GLB instancer.
  if (piles.length && rubbleGlbSrc) {
    for (const p of piles) {
      const pile = rubbleGlbSrc.clone(true);
      pile.traverse((obj) => { if (obj.isMesh) obj.material = rubbleMat; });
      fitToSize(pile, p.targetSize);
      pile.position.set(p.px, groundedY(pile) + 0.005, p.pz);
      pile.rotation.y = p.yaw;
      group.add(pile);
    }
  }

  world.scene.add(group);
}

/** Spray dirt patches, dust mounds, and cracked-ground decals across the whole map
 *  so the city floor reads as a chaotic post-quake mess rather than clean asphalt
 *  and clean concrete. Operates on every grid cell, with extra density on roads
 *  and inside damage zones. */
function addGroundMess(scenario, rubbleMat, damageMat) {
  if (!rubbleMat) return;
  const [cols, rows] = scenario.map.size;
  const riskFlat = scenario.map.risk_zones || [];
  const [bxBase, byBase] = scenario.map.base || [-99, -99];
  const baseCx = bxBase + 0.5;
  const baseCz = byBase + 0.5;
  const roadCellSet = computeRoadCells(scenario);
  const buildingRects = buildingAvoidanceRects(scenario);

  // Tint the dirt material slightly darker than rubble for variety.
  const dirtMat = (damageMat || rubbleMat).clone();
  dirtMat.color = (damageMat || rubbleMat).color.clone();

  // Collect placements first, then build a single InstancedMesh per (geometry, material).
  // Without this, each cell could spawn 4+ separate meshes — on a 30×30 map that's ~3.5k draw calls
  // for ground clutter alone, multiplied by every active POV render.
  const patches = []; // { px, pz, w, d, yaw, lift }
  const rubblePieces = []; // { px, py, pz, w, h, d, rx, ry, rz }

  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const damage = cellDamageLevel(cx, cy, riskFlat);
      const isRoad = roadCellSet.has(`${cx},${cy}`);
      const perCell = 2 + Math.floor(hash01(cx, cy, 500) * 2) + (isRoad ? 1 : 0) + Math.floor(damage * 2);
      for (let i = 0; i < perCell; i += 1) {
        const px = cx + 0.15 + hash01(cx + i, cy, 501 + i) * 0.7;
        const pz = cy + 0.15 + hash01(cx, cy + i, 502 + i) * 0.7;
        const dxBase = px - baseCx;
        const dzBase = pz - baseCz;
        if (dxBase * dxBase + dzBase * dzBase < 1.2) continue;
        if (pointNearBuilding(px, pz, buildingRects, -0.05)) continue;

        const variantRoll = hash01(px, pz, 503);
        if (variantRoll < 0.6) {
          patches.push({
            px, pz,
            w: 0.3 + hash01(px, pz, 504) * 0.7,
            d: 0.3 + hash01(px, pz, 505) * 0.7,
            yaw: hash01(px, pz, 506) * Math.PI * 2,
            lift: 0.052 + hash01(px, pz, 507) * 0.004,
          });
        } else if (variantRoll < 0.85) {
          const h = 0.04 + hash01(px, pz, 509) * 0.06;
          rubblePieces.push({
            px, py: h / 2 + 0.05, pz,
            w: 0.18 + hash01(px, pz, 508) * 0.3,
            h,
            d: 0.18 + hash01(px, pz, 510) * 0.3,
            rx: (hash01(px, pz, 512) - 0.5) * 0.2,
            ry: hash01(px, pz, 511) * Math.PI * 2,
            rz: (hash01(px, pz, 513) - 0.5) * 0.2,
          });
        } else {
          const rh = 0.025 + hash01(px, pz, 515) * 0.05;
          rubblePieces.push({
            px, py: rh / 2 + 0.045, pz,
            w: 0.05 + hash01(px, pz, 514) * 0.1,
            h: rh,
            d: 0.05 + hash01(px, pz, 516) * 0.1,
            rx: (hash01(px, pz, 517) - 0.5) * 0.6,
            ry: hash01(px, pz, 518) * Math.PI * 2,
            rz: (hash01(px, pz, 519) - 0.5) * 0.6,
          });
        }
      }
    }
  }

  const group = new THREE.Group();
  group.name = "ground-mess";
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpE = new THREE.Euler();

  if (patches.length) {
    // Unit XZ-plane: PlaneGeometry is XY by default, rotate -π/2 around X so it lies flat.
    const unitPlane = new THREE.PlaneGeometry(1, 1);
    unitPlane.rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(unitPlane, dirtMat, patches.length);
    inst.frustumCulled = false;
    for (let i = 0; i < patches.length; i += 1) {
      const p = patches[i];
      tmpV.set(p.px, p.lift, p.pz);
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      tmpS.set(p.w, 1, p.d);
      tmpM.compose(tmpV, tmpQ, tmpS);
      inst.setMatrixAt(i, tmpM);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  if (rubblePieces.length) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const inst = new THREE.InstancedMesh(unitBox, rubbleMat, rubblePieces.length);
    inst.frustumCulled = false;
    for (let i = 0; i < rubblePieces.length; i += 1) {
      const p = rubblePieces[i];
      tmpV.set(p.px, p.py, p.pz);
      tmpE.set(p.rx, p.ry, p.rz, "XYZ");
      tmpQ.setFromEuler(tmpE);
      tmpS.set(p.w, p.h, p.d);
      tmpM.compose(tmpV, tmpQ, tmpS);
      inst.setMatrixAt(i, tmpM);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  world.scene.add(group);
}

function addRooftopDetails(group, footprint, height, damage, mats) {
  if (height < 1.1 || damage > 0.82) return;
  const [x, y, w, d] = footprint;
  const cx = x + w / 2;
  const cz = y + d / 2;
  const roofY = height + 0.12;
  const ventMat = mats.vent;
  const railMat = mats.rail;
  const tankMat = mats.tank;

  const units = Math.min(1, Math.max(0, Math.floor(w * d * 0.18)));
  for (let i = 0; i < units; i += 1) {
    if (hash01(cx + i, cz, 250) < damage * 0.35) continue;
    const ux = x + 0.25 + hash01(x + i, y, 251) * Math.max(0.1, w - 0.5);
    const uz = y + 0.25 + hash01(x, y + i, 252) * Math.max(0.1, d - 0.5);
    const unit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.18), ventMat);
    unit.position.set(ux, roofY + 0.06, uz);
    unit.rotation.y = Math.floor(hash01(ux, uz, 253) * 4) * (Math.PI / 2);
    group.add(unit);
  }

  if (height > 3.1 && w > 1.2 && d > 1.2 && hash01(cx, cz, 254) > 0.45) {
    const tank = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 10), tankMat);
    body.position.y = 0.22;
    tank.add(body);
    for (const ox of [-0.11, 0.11]) {
      for (const oz of [-0.11, 0.11]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 5), railMat);
        leg.position.set(ox, 0.06, oz);
        tank.add(leg);
      }
    }
    tank.position.set(x + w * 0.72, roofY, y + d * 0.72);
    group.add(tank);
  }

  if (w > 1.5 && d > 1.5 && damage < 0.5) {
    const railH = 0.14;
    const railY = height + 0.16;
    const railA = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, railH, 0.025), railMat);
    railA.position.set(cx, railY, y + 0.08);
    group.add(railA);
    const railB = railA.clone();
    railB.position.z = y + d - 0.08;
    group.add(railB);
  }
}

function addStreetLevelDetails(group, footprint, height, damage, kind, mats) {
  if (damage > 0.65 || height < 1.4) return;
  const [x, y, w, d] = footprint;
  if (kind !== "lowrise" && kind !== "civic" && hash01(x, y, 260) < 0.55) return;
  const frontZ = y - 0.012;
  const bayCount = Math.max(1, Math.min(3, Math.floor(w)));
  for (let i = 0; i < bayCount; i += 1) {
    const bx = x + ((i + 0.5) / bayCount) * w;
    const shop = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.42, w / bayCount * 0.72), 0.26), mats.shop);
    shop.position.set(bx, 0.34, frontZ);
    group.add(shop);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.5, w / bayCount * 0.82), 0.035, 0.16), mats.awning);
    awning.position.set(bx, 0.52, y - 0.08);
    group.add(awning);
  }
}

function addDamageDecals(group, footprint, height, damage, fire, mats) {
  if (damage < 0.18 && !fire) return;
  const [x, y, w, d] = footprint;
  const cx = x + w / 2;
  const frontZ = y - 0.014;
  const count = fire ? 3 : Math.max(1, Math.floor(damage * 3));
  for (let i = 0; i < count; i += 1) {
    const px = x + 0.2 + hash01(x + i, y, 290) * Math.max(0.1, w - 0.4);
    const py = Math.min(height - 0.25, 0.5 + hash01(x, y + i, 291) * height * 0.62);
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18 + damage * 0.25, 0.35 + damage * 0.45),
      fire ? mats.soot : mats.crack
    );
    decal.position.set(px, py, frontZ);
    decal.rotation.z = (hash01(px, py, 292) - 0.5) * 0.35;
    group.add(decal);
  }

  if (fire) {
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.4, w * 0.72), Math.max(0.6, height * 0.72)), mats.soot);
    scorch.position.set(cx, Math.max(0.35, height * 0.45), y + d + 0.014);
    scorch.rotation.y = Math.PI;
    group.add(scorch);
  }
}

// ── Wildfire-style inferno plume (Points particles with rise + sway + turbulence) ──
// Ported from wildfire-meadow-scene.js::attachWildfireBurnInferno, scaled for the
// urban grid plume (radius ~3–6 cells vs the meadow's tens of metres).
// Adds flame / ember / spark layers on top of the smoke column so the base of
// each fire reads as live flame rather than coloured sphere puffs.

/** @type {THREE.CanvasTexture | null} */
let _urbanSmokeMap = null;
/** @type {THREE.CanvasTexture | null} */
let _urbanSmokeWispMap = null;
/** @type {THREE.CanvasTexture | null} */
let _urbanFlareMap = null;
/** @type {THREE.CanvasTexture | null} */
let _urbanFlareCoreMap = null;
/** @type {THREE.CanvasTexture | null} */
let _urbanSparkMap = null;

function bakeUrbanSmokeBillow(which) {
  const s = which === "smoke_wisp" ? 112 : 96;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const cx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  if (!cx) {
    tex.needsUpdate = true;
    return tex;
  }
  cx.clearRect(0, 0, s, s);
  if (which === "smoke_wisp") {
    for (let k = 0; k < 7; k++) {
      const gx = s * (0.22 + Math.random() * 0.56);
      const gy = s * (0.22 + Math.random() * 0.56);
      const gr = s * (0.07 + Math.random() * 0.22);
      const grad = cx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      grad.addColorStop(0, "rgba(245,240,233,0.42)");
      grad.addColorStop(0.45, "rgba(130,125,120,0.18)");
      grad.addColorStop(1, "rgba(40,38,40,0)");
      cx.fillStyle = grad;
      cx.beginPath();
      cx.arc(gx, gy, gr, 0, Math.PI * 2);
      cx.fill();
    }
  } else {
    const g0 = cx.createRadialGradient(s * 0.5, s * 0.52, s * 0.02, s * 0.5, s * 0.52, s * 0.44);
    if (which === "flare") {
      g0.addColorStop(0, "rgba(255,255,255,0.92)");
      g0.addColorStop(0.16, "rgba(255,235,215,0.78)");
      g0.addColorStop(0.45, "rgba(255,150,74,0.38)");
      g0.addColorStop(0.75, "rgba(200,60,18,0.12)");
      g0.addColorStop(1, "rgba(120,38,14,0)");
    } else if (which === "flare_core") {
      g0.addColorStop(0, "rgba(255,255,255,0.98)");
      g0.addColorStop(0.12, "rgba(255,248,220,0.85)");
      g0.addColorStop(0.38, "rgba(255,200,120,0.35)");
      g0.addColorStop(0.72, "rgba(255,110,48,0.08)");
      g0.addColorStop(1, "rgba(160,42,14,0)");
    } else if (which === "spark") {
      g0.addColorStop(0, "rgba(255,255,255,1)");
      g0.addColorStop(0.18, "rgba(255,236,190,0.95)");
      g0.addColorStop(0.55, "rgba(255,170,96,0.35)");
      g0.addColorStop(1, "rgba(255,120,60,0)");
    } else {
      g0.addColorStop(0, "rgba(240,237,231,0.38)");
      g0.addColorStop(0.32, "rgba(120,115,112,0.22)");
      g0.addColorStop(0.68, "rgba(60,58,58,0.1)");
      g0.addColorStop(1, "rgba(42,41,43,0)");
    }
    cx.fillStyle = g0;
    cx.fillRect(0, 0, s, s);
  }
  tex.needsUpdate = true;
  return tex;
}

function getUrbanSmokeMaps() {
  if (!_urbanSmokeMap) _urbanSmokeMap = bakeUrbanSmokeBillow("smoke");
  if (!_urbanSmokeWispMap) _urbanSmokeWispMap = bakeUrbanSmokeBillow("smoke_wisp");
  if (!_urbanFlareMap) _urbanFlareMap = bakeUrbanSmokeBillow("flare");
  if (!_urbanFlareCoreMap) _urbanFlareCoreMap = bakeUrbanSmokeBillow("flare_core");
  if (!_urbanSparkMap) _urbanSparkMap = bakeUrbanSmokeBillow("spark");
  return {
    smokeMap: _urbanSmokeMap,
    smokeWispMap: _urbanSmokeWispMap,
    flareMap: _urbanFlareMap,
    flareCoreMap: _urbanFlareCoreMap,
    sparkMap: _urbanSparkMap,
  };
}

/**
 * Three Points-based smoke + flame plume at (baseX, baseZ). Returns a step(t, driftX, driftZ)
 * function — wind is supplied per-frame by the parent so multiple plumes oscillate in sync,
 * matching the wildfire inferno's behaviour. Particle motion: rise w/ lift jitter,
 * wind sway, turbulent swirl, recycle when above ceiling or beyond the radial limit.
 */
function attachUrbanSmokePlume(scene, baseX, baseZ, radius) {
  const { smokeMap, smokeWispMap, flareMap, flareCoreMap, sparkMap } = getUrbanSmokeMaps();

  const group = new THREE.Group();
  group.name = "urban_inferno_plume";
  group.position.set(baseX, 0, baseZ);
  scene.add(group);

  const _tmpC0 = new THREE.Color();
  const _tmpC1 = new THREE.Color();

  function spawnLayer(n, tex, conf) {
    const {
      radialMul, minY, spreadY, capY, rise, sway, size, opacity, colorHex,
      renderOrder, name, turbAmp, turbHz, liftJitter, windMul = 1,
      additive = false, varyColorHex,
    } = conf;

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const swirl = new Float32Array(n);
    const liftMul = new Float32Array(n);
    /** @type {Float32Array | null} */
    let colAttr = null;
    const radialLimit = radius * radialMul;

    const reposition = (ix) => {
      const i3 = ix * 3;
      const rr = Math.sqrt(Math.random()) * radialLimit;
      const th = Math.random() * Math.PI * 2;
      pos[i3] = Math.cos(th) * rr;
      pos[i3 + 2] = Math.sin(th) * rr;
      pos[i3 + 1] = minY + Math.random() * spreadY;
      swirl[ix] = Math.random() * Math.PI * 2;
      liftMul[ix] = 1 + (Math.random() * 2 - 1) * liftJitter;
      if (colAttr && varyColorHex != null) {
        _tmpC0.setHex(colorHex);
        _tmpC1.setHex(varyColorHex);
        _tmpC0.lerp(_tmpC1, Math.random() * 0.92);
        colAttr[i3] = _tmpC0.r;
        colAttr[i3 + 1] = _tmpC0.g;
        colAttr[i3 + 2] = _tmpC0.b;
      }
    };

    for (let ix = 0; ix < n; ix++) reposition(ix);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (varyColorHex != null) {
      colAttr = new Float32Array(n * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colAttr, 3));
      for (let ix = 0; ix < n; ix++) {
        const i3 = ix * 3;
        _tmpC0.setHex(colorHex);
        _tmpC1.setHex(varyColorHex);
        _tmpC0.lerp(_tmpC1, Math.random() * 0.92);
        colAttr[i3] = _tmpC0.r;
        colAttr[i3 + 1] = _tmpC0.g;
        colAttr[i3 + 2] = _tmpC0.b;
      }
    }

    const mat = new THREE.PointsMaterial({
      map: tex,
      color: varyColorHex != null ? 0xffffff : colorHex,
      opacity,
      size,
      transparent: true,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
      fog: true,
      toneMapped: !additive,
      vertexColors: varyColorHex != null,
    });

    const pts = new THREE.Points(geo, mat);
    pts.name = name;
    pts.frustumCulled = false;
    pts.renderOrder = renderOrder;
    group.add(pts);

    return (dt, wPhase, driftX, driftZ) => {
      const wx = driftX * windMul * dt;
      const wz = driftZ * windMul * dt;
      for (let ix = 0; ix < n; ix++) {
        const i3 = ix * 3;
        const lift =
          rise * dt * liftMul[ix] *
          (1 + 0.095 * Math.sin(wPhase * 8.95 + swirl[ix]) +
            0.05 * Math.sin(wPhase * 17.3 + ix * 0.31));
        pos[i3 + 1] += lift;
        pos[i3] += wx * sway;
        pos[i3 + 2] += wz * sway;
        if (turbAmp > 0) {
          const tp = wPhase * turbHz + swirl[ix] * 4.17 + ix * 0.051;
          const tu = turbAmp * dt * (0.85 + 0.15 * Math.sin(wPhase * 2.2 + ix));
          pos[i3] += Math.sin(tp) * tu;
          pos[i3 + 2] += Math.cos(tp * 0.88) * tu;
          pos[i3 + 1] += Math.sin(tp * 0.37) * tu * 0.22;
        }
        const dist = Math.hypot(pos[i3], pos[i3 + 2]);
        if (pos[i3 + 1] > capY || dist > radialLimit * 1.08) reposition(ix);
      }
      geo.attributes.position.needsUpdate = true;
    };
  }

  // Four layers matching the wildfire inferno smoke 1:1: low haze, midrange wisps,
  // dense thick column, and a wide low ash drift. Particle counts + sizes scaled
  // down to fit a ~5-unit urban plume vs the meadow's ~14m burn radius. Counts cut
  // ~45% from the wildfire baseline — each plume's per-frame JS step was the hottest
  // path in update3D before this trim.
  const ceilingY = Math.max(28, radius * 7);
  const stepHaze = spawnLayer(90, smokeMap, {
    radialMul: 1.32,
    minY: 0.3,
    spreadY: 9,
    capY: ceilingY,
    rise: 5.6,
    sway: 0.58,
    size: 7,
    opacity: 0.22,
    colorHex: 0x5d5756,
    renderOrder: -4,
    name: "urban_smoke_haze",
    turbAmp: 0.95,
    turbHz: 4.2,
    liftJitter: 0.22,
  });
  const stepWisp = spawnLayer(60, smokeWispMap, {
    radialMul: 1.18,
    minY: 0.6,
    spreadY: 7,
    capY: ceilingY * 0.86,
    rise: 4.4,
    sway: 0.52,
    size: 9,
    opacity: 0.135,
    colorHex: 0x4a4542,
    renderOrder: -3,
    name: "urban_smoke_wisp",
    turbAmp: 1.25,
    turbHz: 3.4,
    liftJitter: 0.35,
  });
  const stepThick = spawnLayer(40, smokeMap, {
    radialMul: 1.2,
    minY: 0.5,
    spreadY: 12,
    capY: ceilingY * 0.8,
    rise: 8.8,
    sway: 0.5,
    size: 11,
    opacity: 0.1,
    colorHex: 0x2e2c2a,
    renderOrder: -2,
    name: "urban_smoke_thick",
    turbAmp: 0.55,
    turbHz: 2.8,
    liftJitter: 0.18,
  });
  // Wide, low ash drift — same as the wildfire "burn_ash_near" layer.
  const stepAsh = spawnLayer(45, smokeMap, {
    radialMul: 1.45,
    minY: 0,
    spreadY: radius * 0.5,
    capY: Math.max(2, radius * 1.4),
    rise: 1.4,
    sway: 0.72,
    size: 0.55,
    opacity: 0.16,
    colorHex: 0x716b66,
    renderOrder: -1,
    name: "urban_smoke_ash_near",
    turbAmp: 1.05,
    turbHz: 2.05,
    liftJitter: 0.4,
    windMul: 1.65,
  });

  // Flame / ember / spark layers — ported from wildfire inferno, particle counts
  // and sizes shrunk for the urban scale (radius in cells vs 14m). These replace
  // the sphere-based fake flame puffs that previously sat at the base of the plume.
  const stepFlameSheet = spawnLayer(55, flareMap, {
    radialMul: 0.96,
    minY: 0,
    spreadY: 2.2,
    capY: radius * 3.65,
    rise: 5.8,
    sway: 0.16,
    size: Math.min(1.8, radius * 1.02),
    opacity: 0.26,
    colorHex: 0xffd4a8,
    varyColorHex: 0xff8428,
    renderOrder: 0,
    name: "urban_flame_sheet",
    turbAmp: 0.48,
    turbHz: 9.5,
    liftJitter: 0.28,
  });
  const stepFlameNear = spawnLayer(65, flareMap, {
    radialMul: 1,
    minY: 0,
    spreadY: 0.8,
    capY: radius * 2.72,
    rise: 7.8,
    sway: 0.13,
    size: Math.min(1.3, radius * 0.68),
    opacity: 0.2,
    colorHex: 0xff9646,
    varyColorHex: 0xff5a1c,
    renderOrder: 1,
    name: "urban_flame_near",
    turbAmp: 0.36,
    turbHz: 11.2,
    liftJitter: 0.2,
  });
  const stepFlameCore = spawnLayer(32, flareCoreMap, {
    radialMul: 0.72,
    minY: 0,
    spreadY: 0.4,
    capY: radius * 1.55,
    rise: 6.2,
    sway: 0.08,
    size: Math.min(0.72, radius * 0.36),
    opacity: 0.88,
    colorHex: 0xffeecc,
    varyColorHex: 0xffa040,
    renderOrder: 3,
    name: "urban_flame_core",
    turbAmp: 0.22,
    turbHz: 14.5,
    liftJitter: 0.15,
    additive: true,
  });
  const stepEmberBurst = spawnLayer(65, flareMap, {
    radialMul: 1,
    minY: 0,
    spreadY: 0.5,
    capY: radius * 2.25,
    rise: 9.2,
    sway: 0.07,
    size: Math.min(0.88, radius * 0.48),
    opacity: 0.78,
    colorHex: 0xff7a42,
    varyColorHex: 0xff3400,
    renderOrder: 4,
    name: "urban_ember_burst",
    turbAmp: 0.28,
    turbHz: 12.8,
    liftJitter: 0.32,
    additive: true,
  });
  const stepSparks = spawnLayer(32, sparkMap, {
    radialMul: 0.92,
    minY: 0.05,
    spreadY: 0.4,
    capY: radius * 8.25,
    rise: 11.8,
    sway: 0.22,
    size: Math.min(0.42, radius * 0.26),
    opacity: 0.95,
    colorHex: 0xfff2c4,
    varyColorHex: 0xff9040,
    renderOrder: 6,
    name: "urban_sparks",
    turbAmp: 0.95,
    turbHz: 18.7,
    liftJitter: 0.55,
    additive: true,
  });

  let prevT = NaN;
  return (t, driftX, driftZ) => {
    const dt = Number.isFinite(prevT)
      ? Math.min(Math.max(t - prevT, 1e-4), 1 / 18)
      : 1 / 55;
    prevT = t;
    stepHaze(dt, t, driftX, driftZ);
    stepWisp(dt, t, driftX, driftZ);
    stepThick(dt, t, driftX, driftZ);
    stepAsh(dt, t, driftX, driftZ);
    stepFlameSheet(dt, t, driftX, driftZ);
    stepFlameNear(dt, t, driftX, driftZ);
    stepFlameCore(dt, t, driftX, driftZ);
    stepEmberBurst(dt, t, driftX, driftZ);
    stepSparks(dt, t, driftX, driftZ);
  };
}

function addFireSmoke(scenario) {
  const fireZones = (scenario?.map?.risk_zones || []).filter((z) => z.type === "fire");
  if (!fireZones.length) return;
  world.smokeSteps = world.smokeSteps || [];
  world.fireGlows = world.fireGlows || [];

  for (const z of fireZones) {
    const baseX = z.center[0] + 0.5;
    const baseZ = z.center[1] + 0.5;

    // Warm wash so flames + nearby façades read as lit by the fire.
    const glow = new THREE.PointLight(0xff6020, 2.0, 9, 1.8);
    glow.position.set(baseX, 0.6, baseZ);
    world.scene.add(glow);
    world.fireGlows.push(glow);

    // Plume radius scales with the fire zone footprint (default ~3 cells).
    // Wind is supplied per-frame by updateSmokeAndGlows so every plume oscillates
    // together. The plume includes flame, ember & spark Points layers, replacing
    // the old sphere-based fake-flame puffs.
    const radius = Math.max(2.5, (z.radius ?? 3) * 0.9);
    world.smokeSteps.push(attachUrbanSmokePlume(world.scene, baseX, baseZ, radius));
  }
}

function updateSmokeAndGlows(t) {
  if (world.smokeSteps?.length) {
    // Oscillating shared wind — same pattern as wildfire inferno
    // (driftX = sin(w*4.05) * 12.5, driftZ = cos(w*3.07) * 11.2 in metres).
    // Urban units are ~10× smaller, so amplitudes are scaled down to ~1.25 / 1.12.
    const driftX = Math.sin(t * 4.05) * 1.25;
    const driftZ = Math.cos(t * 3.07) * 1.12;
    for (const step of world.smokeSteps) step(t, driftX, driftZ);
  }
  if (world.fireGlows) {
    // Only PointLights remain in fireGlows now that fake-flame spheres are gone —
    // flicker the warm wash so flames feel alive even from a distance.
    for (const g of world.fireGlows) {
      if (g.intensity !== undefined) {
        g.intensity = 1.6 + Math.sin(t * 8 + g.position.x) * 0.5 + Math.sin(t * 13 + g.position.z) * 0.3;
      }
    }
  }
  // Sky cloud drift — slow rotation around the city center, gentle vertical bob,
  // and a subtle opacity breath so the atmosphere feels alive.
  if (world.skyClouds?.length) {
    for (const c of world.skyClouds) {
      const ang = c.ang + t * 0.012 + Math.sin(t * 0.04 + c.phase * 1.7) * 0.18;
      c.mesh.position.x = c.cx + Math.cos(ang) * c.dist;
      c.mesh.position.z = c.cz + Math.sin(ang) * c.dist;
      c.mesh.position.y = c.height + Math.sin(t * 0.08 + c.phase * 2.3) * 0.6;
      const mat = c.mesh.material;
      if (mat) mat.opacity = c.baseOpacity * (0.85 + Math.sin(t * 0.15 + c.phase) * 0.18);
    }
  }
}

/** Lamp posts at every road intersection + EZ-Trees in grass patches. */
function addStreetFurniture(scenario) {
  const [cols, rows] = scenario.map.size;
  const riskZones = scenario.map.risk_zones || [];
  const hLines = new Set();
  const vLines = new Set();

  for (const road of get3DRoads(scenario)) {
    const pts = road.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a[1] === b[1]) hLines.add(a[1]);
      if (a[0] === b[0]) vLines.add(a[0]);
    }
  }

  const tex = ensureRoadTextures();
  const postMetalTex = tiledClone(tex.metal, 1, 3);
  const armMetalTex = tiledClone(tex.metal, 1, 1);
  const postMat = new THREE.MeshStandardMaterial({ map: postMetalTex, color: 0x4a4e54, roughness: 0.7, metalness: 0.55 });
  const armMat = new THREE.MeshStandardMaterial({ map: armMetalTex, color: 0x52565c, roughness: 0.65, metalness: 0.6 });

  /** Skip lamp posts on cells adjacent to the base so they don't stand in the spawn pad. */
  const baseX = scenario.map.base?.[0];
  const baseY = scenario.map.base?.[1];

  // Shared lit/unlit head materials so the instanced heads can share a single material per variant.
  // PointLights were dropped — with ~100 intersections each adding a PointLight, every PBR material
  // shader was paying for every lamp's light contribution, and the visible effect at distance was
  // already dominated by the emissive head.
  const litHeadMat = new THREE.MeshStandardMaterial({
    color: 0xffe9b0, emissive: 0xffd080, emissiveIntensity: 0.9, roughness: 0.7,
  });
  const darkHeadMat = new THREE.MeshStandardMaterial({
    color: 0x1a1614, roughness: 0.7,
  });

  // Pre-baked part geometries — one shared layout, arm points in +X model space.
  const lampParts = [
    { geom: new THREE.CylinderGeometry(0.06, 0.07, 0.04, 10), mat: postMat, ly: 0.02, lx: 0, rotZ: 0 },
    { geom: new THREE.CylinderGeometry(0.02, 0.03, 0.7, 10), mat: postMat, ly: 0.39, lx: 0, rotZ: 0 },
    { geom: new THREE.CylinderGeometry(0.028, 0.028, 0.02, 10), mat: armMat, ly: 0.74, lx: 0, rotZ: 0 },
    { geom: new THREE.CylinderGeometry(0.009, 0.011, 0.14, 6), mat: armMat, ly: 0.75, lx: 0.08, rotZ: Math.PI / 2 },
    { geom: new THREE.ConeGeometry(0.065, 0.045, 10, 1, true), mat: armMat, ly: 0.73, lx: 0.15, rotZ: 0 },
  ];
  const lamps = [];
  for (const y of hLines) {
    for (const x of vLines) {
      if (x === 0 || x === cols - 1 || y === 0 || y === rows - 1) continue;
      if (baseX != null && Math.abs(x - baseX) <= 1 && Math.abs(y - baseY) <= 1) continue;
      // Thin out lamps so they don't crowd every intersection — about 65% of
      // intersections get a lamp post.
      if (hash01(x, y, 71) < 0.35) continue;
      const damage = cellDamageLevel(x, y, riskZones);
      /** One lamp per intersection (was two diagonals) — halves the per-frame draw count. */
      const lampPick = hash01(x, y, 70);
      const lampCorners = [[-1, -1], [1, 1], [-1, 1], [1, -1]];
      const [ox, oz] = lampCorners[Math.floor(lampPick * 4) % 4];
      const isLit = damage < 0.4 && hash01(x, y, 50 + ox + oz * 2) > 0.15;
      const damageZ = damage > 0.45 ? (hash01(x, y, 51 + ox + oz * 2) - 0.5) * 0.6 : 0;
      const damageX = damage > 0.45 ? (hash01(x, y, 52 + ox + oz * 2) - 0.5) * 0.3 : 0;
      lamps.push({
        // Bumped from 0.55 → 0.78 so the lamp sits deeper into the non-road
        // quadrant, away from where vehicles pass through the intersection.
        px: x + 0.5 + ox * 0.78,
        pz: y + 0.5 + oz * 0.78,
        // ox=1 lamps are mirrored along X: rotate 180° around Y so the shared +X-arm layout faces inward.
        yaw: ox === 1 ? Math.PI : 0,
        damageX, damageZ, isLit,
      });
    }
  }

  if (lamps.length) {
    const lampGroup = new THREE.Group();
    lampGroup.name = "street-lamps";
    const tmpOuter = new THREE.Matrix4();
    const tmpInst = new THREE.Matrix4();
    const tmpYaw = new THREE.Matrix4();
    const tmpDamage = new THREE.Matrix4();
    const tmpPos = new THREE.Matrix4();
    const tmpEuler = new THREE.Euler();
    const buildPartInstance = (geom, mat, partLocal, filter = null) => {
      const list = filter ? lamps.filter(filter) : lamps;
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(geom, mat, list.length);
      inst.frustumCulled = false;
      for (let i = 0; i < list.length; i += 1) {
        const L = list[i];
        // outer = T(pos) * R_y(yaw) * R_euler(damageX, 0, damageZ) — yaw before damage so the
        // mirrored ox=1 lamps tilt the same way as their non-mirrored mates.
        tmpPos.makeTranslation(L.px, 0, L.pz);
        tmpYaw.makeRotationY(L.yaw);
        tmpEuler.set(L.damageX, 0, L.damageZ, "XYZ");
        tmpDamage.makeRotationFromEuler(tmpEuler);
        tmpOuter.identity().multiply(tmpPos).multiply(tmpYaw).multiply(tmpDamage);
        tmpInst.multiplyMatrices(tmpOuter, partLocal);
        inst.setMatrixAt(i, tmpInst);
      }
      inst.instanceMatrix.needsUpdate = true;
      lampGroup.add(inst);
    };
    // Precompute each part's local matrix (translation + Z-rot for the arm).
    const makeLocal = (lx, ly, rotZ) => {
      const m = new THREE.Matrix4();
      const t = new THREE.Vector3(lx, ly, 0);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ);
      const s = new THREE.Vector3(1, 1, 1);
      m.compose(t, q, s);
      return m;
    };
    for (const p of lampParts) {
      buildPartInstance(p.geom, p.mat, makeLocal(p.lx, p.ly, p.rotZ));
    }
    // Heads split into lit / unlit so each can share a single material.
    const headGeom = new THREE.CylinderGeometry(0.042, 0.052, 0.055, 10);
    const headLocal = makeLocal(0.15, 0.68, 0);
    buildPartInstance(headGeom, litHeadMat, headLocal, (L) => L.isLit);
    buildPartInstance(headGeom, darkHeadMat, headLocal, (L) => !L.isLit);
    world.scene.add(lampGroup);
  }

  /** EZ-Tree generation — same procedural library used by the wildfire scene.
   *  Bounded count so per-tree CPU cost stays small for urban-quake. */
  const treePresets = ["Oak Small", "Aspen Small", "Ash Small"];
  let treeBudget = 240;
  const buildingRects = buildingAvoidanceRects(scenario);
  const roadCellSet = computeRoadCells(scenario);
  const baseXY = scenario.map.base || [-99, -99];
  // Clear-radius around the spawn point — no trees inside this many cells of base.
  const baseClearRadius = 4;
  const nearBase = (cx, cy) => Math.abs(cx - baseXY[0]) <= baseClearRadius && Math.abs(cy - baseXY[1]) <= baseClearRadius;

  // Fallback wood material — upgradeToAssets swaps these meshes to the textured
  // woodMat once the async texture set finishes loading.
  const fallbackWoodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.92, metalness: 0.05 });

  const addBrokenBranches = (tx, tz, saltBase, count) => {
    for (let k = 0; k < count; k += 1) {
      const ox = (hash01(tx + k, tz, saltBase + 20) - 0.5) * 0.7;
      const oz = (hash01(tx, tz + k, saltBase + 21) - 0.5) * 0.7;
      const length = 0.18 + hash01(tx + k, tz + k, saltBase + 22) * 0.18;
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.035, length, 6),
        fallbackWoodMat
      );
      branch.rotation.z = Math.PI / 2;
      branch.rotation.y = hash01(tx + k, tz - k, saltBase + 23) * Math.PI * 2;
      branch.position.set(tx + ox, 0.035, tz + oz);
      world.scene.add(branch);
      world.brokenBranches.push(branch);
    }
  };

  // Returns the world-space offset that pushes a tree to the far side of its cell
  // (away from any adjacent road cell). Avoids fallen canopies landing on roads
  // where vehicles would visually clip through them. Returns {x,z,adj} where
  // `adj` is true when at least one neighbour is a road cell.
  const offsetAwayFromRoads = (tx, tz) => {
    const cx = Math.floor(tx);
    const cz = Math.floor(tz);
    let pushX = 0;
    let pushZ = 0;
    let adj = false;
    if (roadCellSet.has(`${cx - 1},${cz}`)) { pushX += 1; adj = true; }
    if (roadCellSet.has(`${cx + 1},${cz}`)) { pushX -= 1; adj = true; }
    if (roadCellSet.has(`${cx},${cz - 1}`)) { pushZ += 1; adj = true; }
    if (roadCellSet.has(`${cx},${cz + 1}`)) { pushZ -= 1; adj = true; }
    return { pushX, pushZ, adj };
  };

  const placeTree = (tx, tz, saltBase) => {
    const damage = cellDamageLevel(Math.floor(tx), Math.floor(tz), riskZones);
    // Pick damage state: snapped > fallen > leaning > upright.
    // Baseline percentages even in undamaged cells so the citywide quake reads.
    const stateRoll = hash01(tx, tz, saltBase + 4);
    // Heavily biased toward `fallen` — the dominant post-quake silhouette is trees
    // lying flat on the ground, not leaning or upright stumps.
    const snappedThresh = 0.85 - damage * 0.2;    // ~15% baseline snapped stumps
    const fallenThresh = 0.1 - damage * 0.1;      // ~75% baseline fallen flat
    const leaningThresh = 0.02 - damage * 0.02;   // ~8% baseline leaning, vanishes in damage zones
    // Anything below leaningThresh is upright — ~2% baseline, 0% in damage cells.
    let state;
    if (stateRoll > snappedThresh) state = "snapped";
    else if (stateRoll > fallenThresh) state = "fallen";
    else if (stateRoll > leaningThresh) state = "leaning";
    else state = "upright";

    // Road-adjacency cleanup: push base toward the far side of the cell, downgrade
    // fallen → snapped so the canopy can't extend across the road. Otherwise vehicles
    // visually clip through fallen trunks at intersections.
    const { pushX, pushZ, adj: roadAdj } = offsetAwayFromRoads(tx, tz);
    if (roadAdj) {
      tx += pushX * 0.3;
      tz += pushZ * 0.3;
      if (state === "fallen" || state === "leaning") state = "snapped";
    }

    const presetName = treePresets[Math.floor(hash01(tx, tz, saltBase + 6) * treePresets.length) % treePresets.length];
    const opts = structuredClone(TreePreset[presetName] || TreePreset["Oak Small"]);
    opts.seed = Math.floor((hash01(tx, tz, saltBase + 7) * 1e6)) >>> 0;
    if (opts?.branch?.sections) {
      for (const k of Object.keys(opts.branch.sections)) {
        opts.branch.sections[k] = Math.min(opts.branch.sections[k], 5);
      }
    }
    const tree = new Tree();
    tree.loadFromJson(opts);
    tree.position.set(tx, 0, tz);
    const baseScale = 0.02 + hash01(tx, tz, saltBase + 3) * 0.015;
    tree.scale.setScalar(baseScale);
    tree.rotation.y = hash01(tx, tz, saltBase + 8) * Math.PI * 2;

    if (state === "leaning") {
      const sign = hash01(tx, tz, saltBase + 9) > 0.5 ? 1 : -1;
      tree.rotation.z = (0.2 + hash01(tx, tz, saltBase + 10) * 0.25) * sign;
    } else if (state === "fallen") {
      tree.rotation.z = (Math.PI / 2) * (hash01(tx, tz, saltBase + 5) > 0.5 ? 1 : -1) * 0.85;
    } else if (state === "snapped") {
      tree.scale.y *= 0.18;
    }

    world.scene.add(tree);

    if (state === "fallen" || state === "snapped") {
      const branchCount = 1 + Math.floor(hash01(tx, tz, saltBase + 11) * 3);
      addBrokenBranches(tx, tz, saltBase, branchCount);
    }
  };

  // First pass: grass + plaza + rubble terrain patches (was grass-only)
  for (const patch of get3DTerrain(scenario)) {
    if (treeBudget <= 0) break;
    if (patch.kind !== "grass" && patch.kind !== "plaza" && patch.kind !== "rubble") continue;
    const [px, py, pw, ph] = patch.footprint;
    const treeCount = Math.min(treeBudget, Math.max(1, Math.floor(pw * ph * 0.8)));
    for (let i = 0; i < treeCount; i += 1) {
      const tx = px + 0.3 + hash01(px + i, py, 41) * (pw - 0.6);
      const tz = py + 0.3 + hash01(px, py + i, 42) * (ph - 0.6);
      if (nearBase(Math.floor(tx), Math.floor(tz))) continue;
      placeTree(tx, tz, 40);
      treeBudget -= 1;
      if (treeBudget <= 0) break;
    }
  }

  // Second pass: scatter very densely on empty cells (no roads, no buildings, no base spawn pad).
  // Threshold dropped to 0.22 so the majority of open city cells carry at least one tree —
  // post-quake the streetscape should read as a forest that was levelled.
  for (let cy = 1; cy < rows - 1 && treeBudget > 0; cy += 1) {
    for (let cx = 1; cx < cols - 1 && treeBudget > 0; cx += 1) {
      if (hash01(cx, cy, 360) < 0.22) continue;
      if (roadCellSet.has(`${cx},${cy}`)) continue;
      if (nearBase(cx, cy)) continue;
      const tx = cx + 0.5 + (hash01(cx, cy, 361) - 0.5) * 0.6;
      const tz = cy + 0.5 + (hash01(cx, cy, 362) - 0.5) * 0.6;
      if (pointNearBuilding(tx, tz, buildingRects, 0.15)) continue;
      placeTree(tx, tz, 365);
      treeBudget -= 1;
    }
  }
}

export function init3D(scenario, presetKey, povCols) {
  if (world.initialized || povCols.length === 0) return;
  const pk = presetKey || activePreset || currentScenePreset || "urban_quake";
  world.visualPresetForAssets = pk;
  setCurrentScenePreset(pk);
  const vis = PRESET_VISUAL[pk] || PRESET_VISUAL.urban_quake;
  const s3 = vis.scene3d;
  const [cols, rows] = scenario.map.size;

  // Build shared scene once
  world.scene = new THREE.Scene();
  world.scene.background = new THREE.Color(s3.background);
  world.scene.fog = new THREE.FogExp2(s3.fogColor, s3.fogDensity);

  // Ambient floor so shadow side of objects stays readable in the FPV cone.
  world.scene.add(new THREE.AmbientLight(s3.ambient.color, s3.ambient.intensity));

  // Three-point rig: warm hemi from above, cool fill, soft rim
  const hemi = new THREE.HemisphereLight(s3.hemi.sky, s3.hemi.ground, s3.hemi.intensity);
  world.scene.add(hemi);
  const key = new THREE.DirectionalLight(s3.key.color, s3.key.intensity);
  key.position.set(20, 30, 10);
  world.scene.add(key);
  const fill = new THREE.DirectionalLight(s3.fill.color, s3.fill.intensity);
  fill.position.set(-15, 12, -8);
  world.scene.add(fill);
  const rim = new THREE.PointLight(s3.rim.color, s3.rim.intensity, 80);
  rim.position.set(cols / 2, 22, rows / 2);
  world.scene.add(rim);

  // Ground — neon grid placeholder, swapped to concrete after assets load.
  // Plane is oversized so the perimeter-building ring + outer horizon don't
  // float over an abyss when viewed from ground-level POVs.
  const gridTex = makeGridTexture(512, cols, rows, s3.gridTex);
  const gm = s3.gridMat;
  const groundPad = 12;
  const groundW = cols + groundPad * 2;
  const groundH = rows + groundPad * 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundW, groundH),
    new THREE.MeshStandardMaterial({
      map: gridTex,
      color: gm.color,
      roughness: 0.9,
      metalness: 0.05,
      emissive: gm.emissive,
      emissiveIntensity: gm.emissiveIntensity
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cols / 2, 0, rows / 2);
  world.scene.add(ground);
  world.groundGrid = ground;

  // Sky-dome — smoky disaster gradient with ash-cloud streaks for the FPV horizon
  const skyTex = makeGradientSkyTexture(512, s3.skyStops);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  world.scene.add(sky);

  // Drifting volumetric ash clouds above the city
  world.skyClouds = addSkyClouds(world.scene, cols, rows);

  // Scenario-driven world detail. These helpers are guarded so legacy
  // scenarios without terrain/roads still render the base FPV scene.
  addTerrainPatches3D(scenario);
  addCityGroundDetail(scenario);
  // Primitive building shells removed; upgradeScenarioBuildingsToAssets populates GLB clones.

  // Blockades — primitive boxes that the GLB upgrade pass replaces with rubble-large.glb clones.
  for (const blk of scenario.map.blocked_cells) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.85, metalness: 0.1 })
    );
    mesh.position.set(blk.location[0] + 0.5, 0.6, blk.location[1] + 0.5);
    world.scene.add(mesh);
    world.blockadeMeshes.set(blk.id, mesh);
  }

  // Risk zones — thin ground ring + halo light + optional smoke column for fire zones.
  for (const zone of scenario.map.risk_zones) {
    const isFire = zone.type === "fire";
    const baseColor = isFire ? 0xff7a3c : 0xa887ff;

    const grp = new THREE.Group();
    grp.position.set(zone.center[0] + 0.5, 0, zone.center[1] + 0.5);

    const ringInner = Math.max(0.1, zone.radius - 0.18);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringInner, zone.radius, 64),
      new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.25, side: THREE.DoubleSide, fog: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    grp.add(ring);

    const halo = new THREE.PointLight(baseColor, isFire ? 0.85 : 0.45, zone.radius * 3.5);
    halo.position.y = 1.4;
    grp.add(halo);

    let column = null;
    if (isFire) {
      const colGeo = new THREE.CylinderGeometry(0.05, 0.18, 3.2, 8, 1, true);
      const colMat = new THREE.MeshBasicMaterial({
        color: 0xff4a1a,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true
      });
      column = new THREE.Mesh(colGeo, colMat);
      column.position.y = 1.6;
      grp.add(column);
    }

    world.scene.add(grp);
    world.riskMeshes.set(zone.id, { group: grp, ring, halo, column, baseColor, isFire });
  }

  // Victims — primitive post + arm markers that the OBJ upgrade pass replaces with injured-soldier clones.
  for (const v of scenario.victims) {
    const grp = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0xff6666, emissive: 0xff6666, emissiveIntensity: 0.6 })
    );
    post.position.y = 0.45;
    grp.add(post);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xff6666, emissive: 0xff6666, emissiveIntensity: 0.6 })
    );
    arm.position.y = 0.75;
    grp.add(arm);
    const flare = new THREE.PointLight(0xff6666, 0.7, 4);
    flare.position.y = 0.8;
    grp.add(flare);
    grp.position.set(v.location[0] + 0.5, 0, v.location[1] + 0.5);
    world.scene.add(grp);
    world.victimMeshes.set(v.id, { group: grp, post, arm, flare });
  }

  buildRoads3D(scenario);
  addFireSmoke(scenario);
  addStreetFurniture(scenario);

  // Agents — detailed primitive build matching the marketing hero aesthetic
  for (const a of scenario.agents) {
    const grp = createAgentMesh(a.type);
    grp.position.set(a.location[0] + 0.5, agentBaseAltitude(a.type), a.location[1] + 0.5);
    world.scene.add(grp);
    world.agentMeshes.set(a.id, grp);
  }

  // Create per-viewport renderer + camera
  povCols.forEach((col, i) => {
    const canvas = col.querySelector("[data-pov-canvas]");
    if (!canvas) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (err) {
      console.warn(`WebGL unavailable for POV ${i}`, err);
      canvas.replaceWith(Object.assign(document.createElement("div"), {
        style: "padding: 16px; color: #ffd95d; font-size: 10px; text-align: center;",
        textContent: "WebGL unavailable"
      }));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(s3.rendererClear, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = s3.toneExposure ?? 1.4;

    const camera = new THREE.PerspectiveCamera(72, 16 / 10, 0.1, 80);
    camera.position.set(cols / 2, 1.5, rows / 2);
    camera.lookAt(cols / 2 + 1, 0.8, rows / 2);

    // Camera-mounted spotlight so the operator can see the immediate forward
    // surroundings of the active agent. Each POV gets its own light so multiple
    // viewports don't double-illuminate the same agent.
    const povSpot = new THREE.SpotLight(0xffd9a0, 1.6, 18, Math.PI / 4, 0.4, 1.0);
    povSpot.position.set(0, 0, 0);
    povSpot.target.position.set(0, 0, -6);
    camera.add(povSpot);
    camera.add(povSpot.target);
    world.scene.add(camera);

    const initialId = ui3d.DEFAULT_POV_AGENTS[i] || scenario.agents[i]?.id || scenario.agents[0]?.id;
    const heading = col.querySelector("[data-pov-heading]");
    if (heading) heading.textContent = `FPV · ${initialId}`;

    const entry = {
      col,
      canvas,
      renderer,
      camera,
      povSpot,
      selectedId: initialId,
      smoothPos: new THREE.Vector3().copy(camera.position),
      smoothLook: new THREE.Vector3(cols / 2 + 1, 0.8, rows / 2),
      smoothHdg: 0,
      smoothVel: 0,
      visible: true,
      hud: {
        alt: col.querySelector("[data-hud='alt']"),
        hdg: col.querySelector("[data-hud='hdg']"),
        vel: col.querySelector("[data-hud='vel']"),
        pwr: col.querySelector("[data-hud='pwr']"),
        target: col.querySelector("[data-hud='target']"),
        heading
      }
    };

    const ro = new ResizeObserver(() => resizePov(entry));
    ro.observe(canvas.parentElement);

    /** Skip the per-POV render path when the viewport is scrolled off-screen. */
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) entry.visible = e.isIntersecting;
      }, { rootMargin: "200px" });
      io.observe(col);
    }

    povs.push(entry);
    resizePov(entry);
  });

  // Rich agent-card switcher
  buildAgentSelector(scenario.agents);

  world.initialized = true;

  // Progressive asset upgrade — primitives show first, real geometry swaps in
  upgradeToAssets(scenario).catch((err) => console.warn("Asset upgrade failed:", err));
}


function resizePov(entry) {
  if (!entry || !entry.renderer || !entry.canvas.parentElement) return;
  const w = entry.canvas.parentElement.clientWidth;
  const h = entry.canvas.parentElement.clientHeight;
  if (w === 0 || h === 0) return;
  entry.renderer.setSize(w, h, false);
  entry.camera.aspect = w / h;
  entry.camera.updateProjectionMatrix();
}

function fitToSize(obj, targetMaxDim) {
  const bbox = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  obj.scale.setScalar(targetMaxDim / maxDim);
}

function groundedY(obj) {
  const bbox = new THREE.Box3().setFromObject(obj);
  return -bbox.min.y;
}

/** Walks each pre-fitted building template once and snapshots its meshes:
 *  bounding-box size, base Y (for ground lift), and every mesh's
 *  (geometry, material, world-relative localMatrix). Lets us draw N building
 *  copies as one InstancedMesh per (template, mesh) pair instead of N×K clones. */
function prepBuildingTemplateMeta(templates) {
  return templates.map((root) => {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const children = [];
    root.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        children.push({
          geometry: obj.geometry,
          material: obj.material,
          localMatrix: obj.matrixWorld.clone(),
        });
      }
    });
    return { size, baseMinY: bbox.min.y, children };
  });
}

function templateIndexForKind(kind, count) {
  const byKind = { apartment: 0, civic: 1, lowrise: 2, warehouse: 3 };
  const idx = byKind[kind] ?? 0;
  return idx % count;
}

/** Build a Group containing one InstancedMesh per (template, child-mesh) pair.
 *  `placements` carry the world position, anisotropic footprint, height, yaw,
 *  and the templateIndex selecting which prototype to draw. */
function placeBuildingsInstanced(groupName, templateMeta, placements) {
  const byTemplate = new Map();
  for (const p of placements) {
    const idx = p.templateIndex % templateMeta.length;
    let arr = byTemplate.get(idx);
    if (!arr) { arr = []; byTemplate.set(idx, arr); }
    arr.push(p);
  }
  const group = new THREE.Group();
  group.name = groupName;
  const outerM = new THREE.Matrix4();
  const instM = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const [tIdx, list] of byTemplate) {
    const meta = templateMeta[tIdx];
    if (!meta || !meta.children.length) continue;
    for (const ch of meta.children) {
      const inst = new THREE.InstancedMesh(ch.geometry, ch.material, list.length);
      inst.frustumCulled = false;
      for (let i = 0; i < list.length; i += 1) {
        const p = list[i];
        const sx = Math.max(0.01, (p.w - 0.14) / Math.max(meta.size.x, 0.01));
        const sy = Math.max(0.01, p.h / Math.max(meta.size.y, 0.01));
        const sz = Math.max(0.01, (p.d - 0.14) / Math.max(meta.size.z, 0.01));
        const yLift = -meta.baseMinY * sy + 0.025;
        pos.set(p.x, yLift, p.z);
        quat.setFromAxisAngle(yAxis, p.yaw);
        scl.set(sx, sy, sz);
        outerM.compose(pos, quat, scl);
        instM.multiplyMatrices(outerM, ch.localMatrix);
        inst.setMatrixAt(i, instM);
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
  }
  return group;
}

function upgradeScenarioBuildingsToAssets(scenario, templateMeta) {
  const buildings = scenarioBuildingEntries(scenario);
  if (!buildings.length || !templateMeta?.length) return;

  if (world.scenarioBuildingsGroup) {
    world.scene.remove(world.scenarioBuildingsGroup);
    disposeObject(world.scenarioBuildingsGroup);
    world.scenarioBuildingsGroup = null;
  }

  const placements = [];
  for (const b of buildings) {
    const [x, y, w, d] = b.footprint;
    if (w <= 0 || d <= 0) continue;
    const profile = buildingProfile(b.kind);
    const targetHeight = profile.minH + hash01(x, y, 130) * (profile.maxH - profile.minH);
    const [rx, ry, rw, rd] = buildingRenderFootprint(x, y, w, d, targetHeight);
    placements.push({
      templateIndex: templateIndexForKind(b.kind, templateMeta.length),
      x: rx + rw / 2,
      z: ry + rd / 2,
      w: rw,
      d: rd,
      h: targetHeight,
      yaw: Math.floor(hash01(x, y, 136) * 4) * (Math.PI / 2),
    });
  }

  const group = placeBuildingsInstanced("scenario-buildings-assets", templateMeta, placements);
  world.scene.add(group);
  world.scenarioBuildingsGroup = group;
}

async function upgradeToAssets(scenario) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(draco);
  const texLoader = new THREE.TextureLoader();

  const M = "/models/";
  const T = "/textures/";

  const [
    aptGlb, facadeGlb, mansionGlb, multiGlb,
    rubbleGlb, signsGlb, soldierPrototype, taxiGlb,
    cBase, cNorm, cRough,
    bBase, bNorm, bRough,
    pBase, pNorm, pRough,
    dBase, dNorm, dRough,
    c2Base, c2Norm, c2Rough,
    rBase, rNorm, rRough,
    wBase, wNorm, wRough,
    mBase, mMetal, mNorm, mRough,
  ] = await Promise.all([
    loader.loadAsync(`${M}building-apartment.glb`),
    loader.loadAsync(`${M}building-facade.glb`),
    loader.loadAsync(`${M}building-mansion.glb`),
    loader.loadAsync(`${M}building-multistory.glb`),
    loader.loadAsync(`${M}rubble-large.glb`),
    loader.loadAsync(`${M}street-signs.glb`),
    loadInjuredSoldierPrototype(),
    loader.loadAsync(`${M}vehicle-taxi.glb`),
    texLoader.loadAsync(`${T}concrete-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}concrete-a_normal.jpg`),
    texLoader.loadAsync(`${T}concrete-a_roughness.jpg`),
    texLoader.loadAsync(`${T}bricks-damage_basecolor.jpg`),
    texLoader.loadAsync(`${T}bricks-damage_normal.jpg`),
    texLoader.loadAsync(`${T}bricks-damage_roughness.jpg`),
    texLoader.loadAsync(`${T}plaster-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}plaster-a_normal.jpg`),
    texLoader.loadAsync(`${T}plaster-a_roughness.jpg`),
    texLoader.loadAsync(`${T}damage-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}damage-a_normal.jpg`),
    texLoader.loadAsync(`${T}damage-a_roughness.jpg`),
    texLoader.loadAsync(`${T}concrete-b_basecolor.jpg`),
    texLoader.loadAsync(`${T}concrete-b_normal.jpg`),
    texLoader.loadAsync(`${T}concrete-b_roughness.jpg`),
    texLoader.loadAsync(`${T}rubble-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}rubble-a_normal.jpg`),
    texLoader.loadAsync(`${T}rubble-a_roughness.jpg`),
    texLoader.loadAsync(`${T}wood-a_basecolor.jpg`),
    texLoader.loadAsync(`${T}wood-a_normal.jpg`),
    texLoader.loadAsync(`${T}wood-a_roughness.jpg`),
    texLoader.loadAsync(`${T}metal-rust_basecolor.jpg`),
    texLoader.loadAsync(`${T}metal-rust_metallic.jpg`),
    texLoader.loadAsync(`${T}metal-rust_normal.jpg`),
    texLoader.loadAsync(`${T}metal-rust_roughness.jpg`),
  ]);

  // Preset switched away (e.g. to wildfire) while assets were downloading — abort quietly.
  if (!world.initialized || !world.scene) return;

  const prepTexSet = (base, norm, rough, repeat = 2) => {
    base.colorSpace = THREE.SRGBColorSpace;
    for (const tex of [base, norm, rough]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      tex.anisotropy = 4;
    }
  };
  prepTexSet(cBase, cNorm, cRough);
  prepTexSet(bBase, bNorm, bRough);
  prepTexSet(pBase, pNorm, pRough);
  prepTexSet(dBase, dNorm, dRough);
  prepTexSet(c2Base, c2Norm, c2Rough);
  prepTexSet(rBase, rNorm, rRough);
  prepTexSet(wBase, wNorm, wRough);
  // Metal-rust set carries an extra metallic map; same wrap/repeat settings
  for (const tex of [mBase, mMetal, mNorm, mRough]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.anisotropy = 4;
  }
  mBase.colorSpace = THREE.SRGBColorSpace;

  const makeMat = (base, norm, rough, tint) => new THREE.MeshStandardMaterial({
    map: base,
    normalMap: norm,
    roughnessMap: rough,
    color: tint,
    roughness: 0.88,
    metalness: 0.06
  });
  const concreteMat = makeMat(cBase, cNorm, cRough, 0x95a1ad);
  const brickMat = makeMat(bBase, bNorm, bRough, 0xa17560);
  const plasterMat = makeMat(pBase, pNorm, pRough, 0xb2a48a);
  const damageMat = makeMat(dBase, dNorm, dRough, 0x6f6256);
  const concreteBMat = makeMat(c2Base, c2Norm, c2Rough, 0x8c97a2);
  const rubbleMat = makeMat(rBase, rNorm, rRough, 0x7a6450);
  const woodMat = makeMat(wBase, wNorm, wRough, 0x8a6a44);
  const rustMat = new THREE.MeshStandardMaterial({
    map: mBase,
    normalMap: mNorm,
    roughnessMap: mRough,
    metalnessMap: mMetal,
    color: 0x6b554a,
    roughness: 0.6,
    metalness: 0.85
  });

  const buildingMats = [concreteMat, brickMat, plasterMat, damageMat, concreteBMat];

  // Pre-bake building templates — assign a material variant per building family.
  // Target max dim ~1.3 so most buildings sit at 1.0–1.3u tall (≈10–13m in sim
  // scale, post-earthquake collapsed structures) — drones flying at 1.5u clear them.
  const buildingTemplates = [aptGlb.scene, facadeGlb.scene, mansionGlb.scene, multiGlb.scene].map((src, idx) => {
    const root = src.clone(true);
    const mat = buildingMats[idx % buildingMats.length];
    root.traverse((obj) => {
      if (obj.isMesh) obj.material = mat;
    });
    fitToSize(root, 1.3);
    return root;
  });

  const buildingTemplateMeta = prepBuildingTemplateMeta(buildingTemplates);
  upgradeScenarioBuildingsToAssets(scenario, buildingTemplateMeta);
  addPerimeterBuildings(scenario, buildingTemplateMeta);

  // Swap blockades for rubble GLB
  for (const blk of scenario.map.blocked_cells) {
    const old = world.blockadeMeshes.get(blk.id);
    if (old) {
      world.scene.remove(old);
      old.traverse?.((obj) => {
        if (obj.isMesh) obj.geometry?.dispose?.();
      });
    }
    const rubble = rubbleGlb.scene.clone(true);
    rubble.traverse((obj) => {
      if (obj.isMesh) obj.material = rubbleMat;
    });
    fitToSize(rubble, 0.8);
    rubble.position.set(blk.location[0] + 0.5, groundedY(rubble), blk.location[1] + 0.5);
    rubble.rotation.y = (blk.location[0] * 13 + blk.location[1] * 7) * 0.31;
    world.scene.add(rubble);
    world.blockadeMeshes.set(blk.id, rubble);
  }

  // Swap victim primitives for the injured-soldier OBJ (posed prone, olive-tinted).
  // The helper normalises scale + bottom-aligns to y=0, so callers only set yaw/position.
  for (const v of scenario.victims) {
    const old = world.victimMeshes.get(v.id);
    if (old?.group) {
      world.scene.remove(old.group);
    }
    // 1.2u long fits comfortably between debris piles at the 1-unit cell scale.
    const soldier = createInjuredSoldierInstance(soldierPrototype, 0.24);
    soldier.rotation.y = (v.id.charCodeAt(1) || 0) * 0.7;
    const grp = new THREE.Group();
    grp.add(soldier);
    const flare = new THREE.PointLight(0xff6666, 0.7, 4);
    flare.position.y = 0.4;
    grp.add(flare);
    grp.position.set(v.location[0] + 0.5, 0, v.location[1] + 0.5);

    const meshes = [];
    soldier.traverse((obj) => {
      if (obj.isMesh) meshes.push(obj);
    });
    world.scene.add(grp);
    world.victimMeshes.set(v.id, { group: grp, flare, meshes, isAsset: true });
  }

  // Scatter rubble, stones, and concrete chunks across roads and sidewalks
  addRoadDebris(scenario, rubbleMat, rubbleGlb.scene);

  // Citywide dirt, dust mounds, and cracked-concrete shards on every cell.
  addGroundMess(scenario, rubbleMat, damageMat);

  // Upgrade any broken-branch primitives placed during synchronous tree setup
  // to the textured wood material now that it's ready.
  if (world.brokenBranches?.length) {
    for (const branch of world.brokenBranches) {
      branch.material = woodMat;
    }
  }

  // Dress the starting area with realistic GLB clones so the spawn pad reads as a city block
  dressBaseCamp(scenario, taxiGlb.scene, signsGlb.scene, rubbleGlb.scene, { rustMat, rubbleMat });

  // Scatter decorative survivor clones in rubble / collapsed blocks (not tracked by sim)
  addInjuredProps(scenario, soldierPrototype);

  // Texture the ground — use the second concrete variant so it reads distinct from building walls
  if (world.groundGrid) {
    const groundBase = c2Base.clone();
    const groundNorm = c2Norm.clone();
    const groundRough = c2Rough.clone();
    // Tile density (~12 reps over a 30-unit play area) — scale with the
    // oversized plane so the outer apron doesn't stretch into a blur.
    const gParams = world.groundGrid.geometry.parameters;
    const repX = Math.max(12, Math.round((gParams?.width ?? 30) * 0.4));
    const repY = Math.max(12, Math.round((gParams?.height ?? 30) * 0.4));
    for (const tex of [groundBase, groundNorm, groundRough]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repX, repY);
      tex.needsUpdate = true;
    }
    groundBase.colorSpace = THREE.SRGBColorSpace;
    const gUp = (PRESET_VISUAL[world.visualPresetForAssets] || PRESET_VISUAL.urban_quake).groundUpgrade;
    world.groundGrid.material.dispose();
    world.groundGrid.material = new THREE.MeshStandardMaterial({
      map: groundBase,
      normalMap: groundNorm,
      roughnessMap: groundRough,
      color: gUp.color,
      roughness: 0.95,
      metalness: 0.05,
      emissive: gUp.emissive,
      emissiveIntensity: gUp.emissiveIntensity
    });
  }
}

/** Place a handful of realistic GLB clones (taxis, signs, debris) around the
 *  starting base so the spawn point reads as a real city block. Uses the same
 *  assets already loaded by upgradeToAssets — no new geometry. */
function dressBaseCamp(scenario, taxiSrc, signsSrc, rubbleSrc, palette = {}) {
  if (!scenario.map.base) return;
  const { rustMat, rubbleMat } = palette;
  const [bx, by] = scenario.map.base;
  const cx = bx + 0.5;
  const cz = by + 0.5;
  const buildingRects = buildingAvoidanceRects(scenario);
  const occupied = [
    { x: cx, z: cz, r: 0.7 },
    ...((scenario.agents || []).map((a) => ({ x: a.location[0] + 0.5, z: a.location[1] + 0.5, r: 0.55 }))),
    ...((scenario.victims || []).map((v) => ({ x: v.location[0] + 0.5, z: v.location[1] + 0.5, r: 1.0 }))),
  ];
  const blocked = (x, z) => {
    if (pointNearBuilding(x, z, buildingRects, 0.35)) return true;
    for (const o of occupied) {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < o.r * o.r) return true;
    }
    return false;
  };

  /** Two parked taxis on the curb adjacent to the base. */
  if (taxiSrc) {
    const taxiSpots = [
      { ox: 1.4, oz: -0.05, yaw: Math.PI / 2, rust: true },
      { ox: -1.45, oz: 0.85, yaw: -Math.PI / 2, rust: false },
    ];
    for (const s of taxiSpots) {
      const x = cx + s.ox;
      const z = cz + s.oz;
      if (blocked(x, z)) continue;
      const taxi = taxiSrc.clone(true);
      fitToSize(taxi, 0.45);
      taxi.position.set(x, groundedY(taxi), z);
      taxi.rotation.y = s.yaw;
      if (s.rust && rustMat) taxi.traverse((obj) => { if (obj.isMesh) obj.material = rustMat; });
      world.scene.add(taxi);
    }
  }

  /** Street signs flanking the staging entry. */
  if (signsSrc) {
    const signSpots = [
      { ox: -0.95, oz: -1.05, yaw: 0.6 },
      { ox: 1.05, oz: -1.0, yaw: -0.5 },
      { ox: -1.25, oz: 1.15, yaw: 2.4 },
    ];
    for (const s of signSpots) {
      const x = cx + s.ox;
      const z = cz + s.oz;
      if (blocked(x, z)) continue;
      const sign = signsSrc.clone(true);
      fitToSize(sign, 0.3);
      sign.position.set(x, groundedY(sign), z);
      sign.rotation.y = s.yaw;
      world.scene.add(sign);
    }
  }

  /** Small rubble piles around the perimeter — same GLB used elsewhere for debris. */
  if (rubbleSrc) {
    const rubbleSpots = [
      { ox: 0.85, oz: 1.25, size: 0.3 },
      { ox: -0.7, oz: -1.2, size: 0.4 },
      { ox: 1.4, oz: 1.05, size: 0.28 },
      { ox: -1.15, oz: -0.45, size: 0.34 },
    ];
    for (const s of rubbleSpots) {
      const x = cx + s.ox;
      const z = cz + s.oz;
      if (blocked(x, z)) continue;
      const pile = rubbleSrc.clone(true);
      fitToSize(pile, s.size);
      pile.position.set(x, groundedY(pile), z);
      pile.rotation.y = (s.ox + s.oz) * 1.1;
      if (rubbleMat) pile.traverse((obj) => { if (obj.isMesh) obj.material = rubbleMat; });
      world.scene.add(pile);
    }
  }
}

/** Place decorative injured-soldier clones in empty cells across the city
 *  (rubble patches, away from base/agents/victims/buildings). Purely visual —
 *  these are not tracked by the sim or the victim state machine. */
function addInjuredProps(scenario, soldierPrototype) {
  if (!soldierPrototype) return;
  const [cols, rows] = scenario.map.size || [30, 30];
  const buildingRects = buildingAvoidanceRects(scenario);
  const baseXY = scenario.map.base || [-99, -99];
  const occupied = [
    { x: baseXY[0] + 0.5, z: baseXY[1] + 0.5, r: 1.5 },
    ...((scenario.agents || []).map((a) => ({ x: a.location[0] + 0.5, z: a.location[1] + 0.5, r: 0.7 }))),
    ...((scenario.victims || []).map((v) => ({ x: v.location[0] + 0.5, z: v.location[1] + 0.5, r: 0.9 }))),
    ...((scenario.map.blocked_cells || []).map((b) => ({ x: b.location[0] + 0.5, z: b.location[1] + 0.5, r: 0.7 }))),
  ];
  const blocked = (x, z) => {
    if (pointNearBuilding(x, z, buildingRects, 0.25)) return true;
    for (const o of occupied) {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < o.r * o.r) return true;
    }
    return false;
  };

  let placed = 0;
  const target = 14;
  for (let cy = 1; cy < rows - 1 && placed < target; cy += 1) {
    for (let cx = 1; cx < cols - 1 && placed < target; cx += 1) {
      if (hash01(cx, cy, 510) < 0.92) continue;
      const x = cx + 0.5;
      const z = cy + 0.5;
      if (blocked(x, z)) continue;

      const soldier = createInjuredSoldierInstance(soldierPrototype, 0.24);
      soldier.rotation.y = hash01(cx, cy, 511) * Math.PI * 2;
      soldier.position.set(x, 0, z);
      world.scene.add(soldier);
      occupied.push({ x, z, r: 0.8 });
      placed += 1;
    }
  }
}



function makeGridTexture(size, cols, rows, texOpts = {}) {
  const fill = texOpts.fill ?? "#04060a";
  const stroke = texOpts.stroke ?? "rgba(93, 255, 180, 0.32)";
  const hi = texOpts.highlight ?? "rgba(130, 200, 255, 0.06)";
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = fill;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = stroke;
  g.lineWidth = 1.2;
  for (let i = 0; i <= cols; i += 1) {
    const x = (i / cols) * size;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, size);
    g.stroke();
  }
  for (let i = 0; i <= rows; i += 1) {
    const y = (i / rows) * size;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y);
    g.stroke();
  }
  // Sparse "tile" highlights
  g.fillStyle = hi;
  for (let i = 0; i < 40; i += 1) {
    const cx = Math.floor(Math.random() * cols);
    const cy = Math.floor(Math.random() * rows);
    g.fillRect((cx / cols) * size + 1, (cy / rows) * size + 1, size / cols - 2, size / rows - 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function update3D(t, sim) {
  const { state, plan, lastTickAt, msPerTick } = sim;
  if (!world.initialized || !state) return;
  const frac = Math.min(1, Math.max(0, (performance.now() - lastTickAt) / msPerTick));

  // ── Shared scene updates ────────────────────────────────────────────────
  // Particle stepping is by far the hottest per-frame cost — skip it entirely when
  // every POV is scrolled off-screen (each fire zone runs ~450 particles through
  // sin/cos/hypot every frame). prevT inside each plume clamps the resulting dt
  // when the visuals resume so particles don't teleport.
  let anyPovVisible = false;
  for (const entry of povs) {
    if (entry.visible !== false) { anyPovVisible = true; break; }
  }
  if (anyPovVisible) updateSmokeAndGlows(t);

  for (const a of state.agents) {
    const mesh = world.agentMeshes.get(a.id);
    if (!mesh) continue;
    const prev = a.prevLocation || a.location;
    const ix = lerp(prev[0], a.location[0], frac);
    const iy = lerp(prev[1], a.location[1], frac);
    const phase = a.id.charCodeAt(0);
    let targetY;
    if (a.type === "drone") {
      targetY = tacticalFpvAltitudeUrbanUnits(a, t);
    } else if (a.type === "balloon") {
      // hovers high, very slow gentle drift
      targetY = 3.6 + Math.sin(t * 0.35 + phase) * 0.18 + Math.sin(t * 0.18 + phase * 0.5) * 0.12;
    } else {
      targetY = 0;
    }
    mesh.position.set(ix + 0.5, targetY, iy + 0.5);

    const dx = a.location[0] - prev[0];
    const dy = a.location[1] - prev[1];
    if (Math.abs(dx) + Math.abs(dy) > 0.001) {
      const yaw = Math.atan2(dx, dy);
      mesh.rotation.y = lerp(mesh.rotation.y, yaw, 0.15);
    }

    if (mesh.userData.rotors) {
      for (let i = 0; i < mesh.userData.rotors.length; i += 1) {
        mesh.userData.rotors[i].rotation.y = t * 30 + i * 0.5;
      }
    }
    if (mesh.userData.navLight) {
      const blink = 0.5 + 0.5 * Math.sin(t * 6 + a.id.charCodeAt(0));
      mesh.userData.navLight.intensity = a.type === "drone" ? 1.4 + blink * 0.6 : 0.9 + blink * 0.3;
    }
    if (mesh.userData.beacon) {
      const pulse = (Math.sin(t * 4.5 + a.id.charCodeAt(0)) + 1) * 0.5;
      const m = mesh.userData.beacon.material;
      if (m && m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6 + pulse * 4;
    }
    if (mesh.userData.statusRing) {
      const slow = (Math.sin(t * 1.2 + a.id.charCodeAt(0)) + 1) * 0.5;
      const m = mesh.userData.statusRing.material;
      if (m && m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6 + slow * 1.4;
    }
  }

  for (const v of state.victims) {
    const m = world.victimMeshes.get(v.id);
    if (!m) continue;
    const isAlive = v.status === "trapped" || v.status === "unknown";
    const color = v.status === "rescued" ? 0x39ff14 : v.status === "dead" ? 0x444444 : 0xff6666;
    if (m.flare) {
      m.flare.color.setHex(color);
      m.flare.intensity = isAlive ? 0.5 + 0.5 * (Math.sin(t * 4 + v.id.charCodeAt(1) * 0.3) * 0.5 + 0.5) : 0.15;
    }
    if (m.isAsset && m.meshes) {
      const emit = isAlive ? 0.35 : v.status === "rescued" ? 0.6 : 0.05;
      for (const mesh of m.meshes) {
        if (mesh.material.emissive) {
          mesh.material.emissive.setHex(color);
          mesh.material.emissiveIntensity = emit;
        }
      }
    } else if (m.post && m.arm) {
      m.post.material.color.setHex(color);
      m.post.material.emissive.setHex(color);
      m.arm.material.color.setHex(color);
      m.arm.material.emissive.setHex(color);
    }
    if (m.group) {
      m.group.position.y = 0;
    }
  }

  for (const [, rz] of world.riskMeshes) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.2);
    if (rz.ring) rz.ring.material.opacity = 0.18 + pulse * 0.12;
    if (rz.halo) rz.halo.intensity = (rz.isFire ? 0.5 : 0.3) + pulse * 0.4;
    if (rz.column) {
      rz.column.material.opacity = 0.12 + Math.sin(t * 2.4) * 0.04 + 0.06 * pulse;
      rz.column.rotation.y = t * 0.25;
    }
  }

  for (const blk of state.map.blocked_cells) {
    const node = world.blockadeMeshes.get(blk.id);
    if (!node) continue;
    const cleared = blk.status === "cleared";
    if (node.isMesh) {
      if (cleared) {
        node.material.transparent = true;
        node.material.opacity = Math.max(0.05, (node.material.opacity ?? 1) - 0.02);
        node.material.color.setHex(0x39ff14);
        node.scale.y = Math.max(0.05, node.scale.y - 0.01);
        node.position.y = 0.6 * node.scale.y;
      } else {
        node.material.transparent = false;
        node.material.opacity = 1;
        node.material.color.setHex(0x8b4513);
        const progress = blk.clear_progress / blk.repair_cost;
        node.scale.y = Math.max(0.2, 1 - progress * 0.6);
        node.position.y = 0.6 * node.scale.y;
      }
    } else {
      const targetOpacity = cleared ? 0.15 : 1;
      node.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = targetOpacity < 1;
          const cur = obj.material.opacity ?? 1;
          obj.material.opacity = cur + (targetOpacity - cur) * 0.05;
        }
      });
    }
  }

  // ── Per-POV camera + render ─────────────────────────────────────────────
  for (const entry of povs) {
    if (entry.visible === false) continue;
    const driver = state.agents.find((a) => a.id === entry.selectedId) || state.agents[0];
    if (!driver) continue;
    const prev = driver.prevLocation || driver.location;
    const ix = lerp(prev[0], driver.location[0], frac);
    const iy = lerp(prev[1], driver.location[1], frac);

    const phaseSeed = tacticalFpvPhaseSeed(driver);
    const isAerial = driver.type === "drone" || driver.type === "balloon";
    const headBobX = isAerial ? Math.sin(t * 1.6 + phaseSeed) * 0.05 : 0;
    const headBobY = isAerial ? Math.sin(t * 2.2 + phaseSeed) * 0.04 : 0;
    const targetPos = tacticalFpvEyeWorldPosition(ix, iy, driver, t, urbanGridToWorldXZ, {
      groundY: 0,
      pitchScale: 1,
      headBobX,
      headBobY,
    });

    const target = currentTargetFor(driver, state, plan);
    const fwd = tacticalFpvForwardVector(driver, prev, ix, iy, t, target, urbanGridToWorldXZ, 1);
    const lookDist = tacticalFpvLookDistanceWorld(isAerial, 1);
    const lookAt = targetPos.clone().addScaledVector(fwd, lookDist);

    entry.smoothPos.lerp(targetPos, 0.18);
    entry.smoothLook.lerp(lookAt, 0.12);
    entry.camera.position.copy(entry.smoothPos);
    entry.camera.lookAt(entry.smoothLook);

    // Per-agent FOV: balloon keeps the wide survey view; drones get a tight
    // telephoto-style zoom, ground vehicles get a narrower windshield FOV.
    let targetFov;
    if (driver.type === "balloon") targetFov = 72;
    else if (driver.type === "drone") targetFov = 42;
    else targetFov = 52;
    if (Math.abs(entry.camera.fov - targetFov) > 0.01) {
      entry.camera.fov = targetFov;
      entry.camera.updateProjectionMatrix();
    }

    // HUD telemetry
    const vel = Math.hypot(driver.location[0] - prev[0], driver.location[1] - prev[1]) / (msPerTick / 1000);
    entry.smoothVel = lerp(entry.smoothVel, vel, 0.15);
    const hdgRad = Math.atan2(driver.location[0] - prev[0], driver.location[1] - prev[1]);
    const hdgDeg = ((hdgRad * 180) / Math.PI + 360) % 360;
    entry.smoothHdg = lerpAngleDeg(entry.smoothHdg, hdgDeg, 0.12);

    if (entry.hud.alt) entry.hud.alt.textContent = tacticalFpvHudAltUrbanGrid(driver, t, headBobY).toFixed(1);
    if (entry.hud.hdg) entry.hud.hdg.textContent = String(Math.round(entry.smoothHdg)).padStart(3, "0");
    if (entry.hud.vel) entry.hud.vel.textContent = entry.smoothVel.toFixed(1);
    if (entry.hud.pwr) entry.hud.pwr.textContent = `${Math.round(driver.battery)}%`;
    if (entry.hud.target) {
      const targetId = currentTargetIdFor(driver, plan);
      entry.hud.target.textContent = targetId ? `TGT ${targetId}` : "TGT —";
    }

    // Hide own driver for this POV only, then restore for others
    for (const [id, m] of world.agentMeshes) m.visible = id !== driver.id;
    entry.renderer.render(world.scene, entry.camera);
  }

  // Restore all agent visibility (the 2D canvas / other code doesn't care, but be safe)
  for (const m of world.agentMeshes.values()) m.visible = true;
}

/* ── Tear down 3D world so Apply & Reset can rebuild ──────────────────── */
function disposeMaterial(mat) {
  if (!mat) return;
  for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) {
    if (mat[k]) try { mat[k].dispose(); } catch {}
  }
  try { mat.dispose(); } catch {}
}
function disposeObject(obj) {
  if (!obj) return;
  obj.traverse?.((node) => {
    if (node.isMesh) {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach(disposeMaterial);
      else disposeMaterial(node.material);
    }
  });
}

export function teardown3D() {
  teardownAgentSelector();
  if (!world.initialized) return;
  // dispose every child of the scene
  if (world.scene) {
    const children = [...world.scene.children];
    for (const c of children) {
      disposeObject(c);
      world.scene.remove(c);
    }
  }
  // dispose per-pov renderers
  for (const entry of povs) {
    try { entry.renderer.dispose(); } catch {}
    const parent = entry.canvas.parentElement;
    if (parent) {
      // recreate canvas so we can attach a new renderer cleanly
      const fresh = entry.canvas.cloneNode(false);
      parent.replaceChild(fresh, entry.canvas);
    }
  }
  povs.length = 0;
  world.scene = null;
  world.agentMeshes.clear();
  world.victimMeshes.clear();
  world.blockadeMeshes.clear();
  world.riskMeshes.clear();
  world.baseMesh = null;
  world.groundGrid = null;
  world.horizonSilhouette = null;
  world.perimeterBuildings = null;
  world.scenarioBuildingsGroup = null;
  world.roadsGroup = null;
  world.smokeSteps = [];
  world.fireGlows = [];
  world.initialized = false;
}
