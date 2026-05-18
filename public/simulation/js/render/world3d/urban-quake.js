import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import {
  PRESET_VISUAL,
  activePreset,
  currentScenePreset,
  setCurrentScenePreset,
} from "../../config/presets.js";
import { pointNearBuilding } from "../../sim/collision.js";
import { lerp } from "../../sim/math.js";
import { createAgentMesh, agentBaseAltitude } from "./fleet-agents-mesh.js";
import {
  lerpAngleDeg,
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
  scenarioBuildingsGroup: null,
  roadsGroup: null,
  smokePuffs: [],
  fireGlows: [],
  initialized: false,
};

/** Continuous tactical grid indices → world xz (Urban: cell centres at half-integers). */
function urbanGridToWorldXZ(ixc, iyc) {
  return { x: ixc + 0.5, z: iyc + 0.5 };
}

function hash01(x, y, salt = 0) {
  return Math.abs(Math.sin((x + salt * 1.7) * 12.9898 + (y + salt * 0.7) * 78.233) * 43758.5) % 1;
}

const DEFAULT_3D_TERRAIN = [
  { id: "T1", kind: "plaza", footprint: [1, 1, 4, 4] },
  { id: "T2", kind: "grass", footprint: [3, 18, 4, 3] },
  { id: "T3", kind: "grass", footprint: [24, 2, 4, 3] },
  { id: "T4", kind: "water", footprint: [29, 0, 1, 30] },
  { id: "T5", kind: "rubble", footprint: [16, 3, 4, 4] },
  { id: "T6", kind: "rubble", footprint: [14, 17, 4, 3] }
];

const DEFAULT_3D_ROADS = [
  { id: "RH-2", kind: "main", points: [[0, 2], [29, 2]] },
  { id: "RH-8", kind: "main", points: [[0, 8], [29, 8]] },
  { id: "RH-12", kind: "side", points: [[0, 12], [29, 12]] },
  { id: "RH-20", kind: "main", points: [[0, 20], [29, 20]] },
  { id: "RH-28", kind: "side", points: [[0, 28], [29, 28]] },
  { id: "RV-2", kind: "main", points: [[2, 0], [2, 29]] },
  { id: "RV-7", kind: "side", points: [[7, 0], [7, 29]] },
  { id: "RV-12", kind: "main", points: [[12, 0], [12, 29]] },
  { id: "RV-21", kind: "main", points: [[21, 0], [21, 29]] },
  { id: "RV-28", kind: "side", points: [[28, 0], [28, 29]] }
];

const DEFAULT_3D_BUILDINGS = [
  { id: "B1", footprint: [5, 5, 2, 3], kind: "apartment" },
  { id: "B2", footprint: [8, 4, 3, 2], kind: "civic" },
  { id: "B3", footprint: [13, 3, 2, 3], kind: "apartment" },
  { id: "B4", footprint: [15, 4, 3, 3], kind: "civic" },
  { id: "B5", footprint: [22, 5, 3, 2], kind: "lowrise" },
  { id: "B6", footprint: [24, 9, 2, 3], kind: "apartment" },
  { id: "B7", footprint: [6, 10, 3, 2], kind: "lowrise" },
  { id: "B8", footprint: [10, 9, 2, 3], kind: "apartment" },
  { id: "B9", footprint: [14, 10, 3, 2], kind: "civic" },
  { id: "B10", footprint: [18, 11, 3, 3], kind: "civic" },
  { id: "B11", footprint: [22, 13, 3, 3], kind: "warehouse" },
  { id: "B12", footprint: [3, 14, 3, 2], kind: "apartment" },
  { id: "B13", footprint: [8, 15, 2, 3], kind: "lowrise" },
  { id: "B14", footprint: [11, 16, 3, 2], kind: "lowrise" },
  { id: "B15", footprint: [15, 15, 3, 2], kind: "civic" },
  { id: "B16", footprint: [19, 16, 4, 4], kind: "warehouse" },
  { id: "B17", footprint: [25, 17, 2, 3], kind: "lowrise" },
  { id: "B18", footprint: [5, 21, 3, 3], kind: "civic" },
  { id: "B19", footprint: [10, 21, 3, 2], kind: "apartment" },
  { id: "B20", footprint: [14, 22, 3, 3], kind: "civic" },
  { id: "B21", footprint: [19, 22, 4, 3], kind: "warehouse" },
  { id: "B22", footprint: [25, 22, 3, 3], kind: "apartment" },
  { id: "B23", footprint: [3, 25, 3, 3], kind: "lowrise" },
  { id: "B24", footprint: [15, 26, 4, 2], kind: "warehouse" },
  { id: "B25", footprint: [21, 26, 3, 3], kind: "civic" }
];

function scale3DFootprint([x, y, w, h], scenario) {
  const [cols, rows] = scenario.map.size || [30, 30];
  const sx = cols / 30;
  const sy = rows / 30;
  const nx = Math.max(0, Math.min(cols - 1, Math.round(x * sx)));
  const ny = Math.max(0, Math.min(rows - 1, Math.round(y * sy)));
  const nw = Math.max(1, Math.min(cols - nx, Math.round(w * sx)));
  const nh = Math.max(1, Math.min(rows - ny, Math.round(h * sy)));
  return [nx, ny, nw, nh];
}

function get3DTerrain(scenario) {
  return (scenario?.map?.terrain?.length ? scenario.map.terrain : DEFAULT_3D_TERRAIN)
    .map((t) => ({ ...t, footprint: scale3DFootprint(t.footprint, scenario) }));
}

function get3DRoads(scenario) {
  const [cols, rows] = scenario.map.size || [30, 30];
  const sx = cols / 30;
  const sy = rows / 30;
  return (scenario?.map?.roads?.length ? scenario.map.roads : DEFAULT_3D_ROADS).map((r) => ({
    ...r,
    points: (r.points || []).map(([x, y]) => [
      Math.max(0, Math.min(cols - 1, Math.round(x * sx))),
      Math.max(0, Math.min(rows - 1, Math.round(y * sy)))
    ])
  }));
}

function get3DBuildings(scenario) {
  return (scenario?.map?.buildings?.length ? scenario.map.buildings : DEFAULT_3D_BUILDINGS)
    .map((b) => ({ ...b, footprint: scale3DFootprint(b.footprint, scenario) }));
}

function computeRoadCells(scenario) {
  const cells = new Set();
  const roads = get3DRoads(scenario);
  for (const road of roads) {
    const pts = road.points || [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let s = 0; s <= steps; s += 1) {
        const t = steps === 0 ? 0 : s / steps;
        const cx = Math.round(a[0] + dx * t);
        const cy = Math.round(a[1] + dy * t);
        cells.add(`${cx},${cy}`);
      }
    }
  }
  return cells;
}

function cellDamageLevel(cellX, cellY, riskZones) {
  if (!riskZones) return 0;
  let max = 0;
  for (const z of riskZones) {
    const dx = cellX - z.center[0];
    const dy = cellY - z.center[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= z.radius) {
      const inner = 1 - d / Math.max(0.01, z.radius);
      max = Math.max(max, 0.5 + inner * 0.5);
    } else if (d <= z.radius + 2) {
      const fade = 1 - (d - z.radius) / 2;
      max = Math.max(max, fade * 0.3);
    }
  }
  return Math.min(1, max);
}

function makeGradientSkyTexture(size = 512, stops = null) {
  const c = document.createElement("canvas");
  c.width = 16;
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
  g.fillRect(0, 0, 16, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

    if (patch.kind === "rubble") {
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5a4838, roughness: 0.95 });
      const stoneCount = Math.floor(pw * ph * 3);
      for (let i = 0; i < stoneCount; i += 1) {
        const sx = px + 0.1 + hash01(px + i, py, 101) * (pw - 0.2);
        const sz = py + 0.1 + hash01(px, py + i, 102) * (ph - 0.2);
        const sw = 0.1 + hash01(sx, sz, 103) * 0.18;
        const sh = 0.06 + hash01(sx, sz, 104) * 0.12;
        const sd = 0.1 + hash01(sx, sz, 105) * 0.18;
        const stone = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), stoneMat);
        stone.position.set(sx, sh / 2 + 0.02, sz);
        stone.rotation.y = hash01(sx, sz, 106) * Math.PI * 2;
        stone.rotation.x = (hash01(sx, sz, 107) - 0.5) * 0.5;
        world.scene.add(stone);
      }
    } else if (patch.kind === "grass") {
      const tuftMat = new THREE.MeshStandardMaterial({ color: 0x3a5a30, roughness: 0.9 });
      const tuftCount = Math.floor(pw * ph * 2);
      for (let i = 0; i < tuftCount; i += 1) {
        const tx = px + 0.1 + hash01(px + i, py, 111) * (pw - 0.2);
        const tz = py + 0.1 + hash01(px, py + i, 112) * (ph - 0.2);
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 5), tuftMat);
        tuft.position.set(tx, 0.09, tz);
        world.scene.add(tuft);
      }
    }
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

function buildRoads3D(scenario) {
  const roads = get3DRoads(scenario);
  if (!roads.length) return;

  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.95, metalness: 0.05 });
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

      const asphalt = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.03, width), asphaltMat);
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
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x3c4652, roughness: 0.96, metalness: 0.02 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x252b33, roughness: 0.98, metalness: 0.02 });
  const crosswalkMat = new THREE.MeshStandardMaterial({ color: 0xc8d1d8, roughness: 0.88, metalness: 0.02, emissive: 0xc8d1d8, emissiveIntensity: 0.06 });
  const hLines = new Set();
  const vLines = new Set();

  for (const road of roads) {
    const isMain = road.kind === "main";
    const width = isMain ? 1.0 : 0.7;
    const sidewalkW = isMain ? 0.34 : 0.26;
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
        const walk = new THREE.Mesh(new THREE.BoxGeometry(len + 0.04, 0.025, sidewalkW), sidewalkMat);
        walk.position.set(cx + perpX * offset * side, 0.018, cz + perpZ * offset * side);
        walk.rotation.y = -yaw;
        group.add(walk);

        const seamCount = Math.min(32, Math.max(2, Math.floor(len / 1.1)));
        for (let s = 1; s < seamCount; s += 1) {
          if (s % 2 === 0) continue;
          const pos = -len / 2 + (s / seamCount) * len;
          const seam = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.004, sidewalkW * 0.92), seamMat);
          seam.position.set(cx + (dx / len) * pos + perpX * offset * side, 0.034, cz + (dz / len) * pos + perpZ * offset * side);
          seam.rotation.y = -yaw;
          group.add(seam);
        }
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

function buildingProfile(kind) {
  const profiles = {
    apartment: { color: 0x677382, roof: 0x222a32, minH: 3.2, maxH: 5.8, floors: 8 },
    civic: { color: 0x7d786c, roof: 0x252a2e, minH: 2.4, maxH: 4.4, floors: 6 },
    warehouse: { color: 0x5c6470, roof: 0x30343a, minH: 1.6, maxH: 2.6, floors: 3 },
    lowrise: { color: 0x766b5f, roof: 0x2b2927, minH: 2.0, maxH: 3.4, floors: 4 }
  };
  return profiles[kind] || profiles.lowrise;
}

function makeFacadeTexture(kind, fire = false) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const palettes = {
    apartment: ["#596777", "#6d7a86", "#46515d"],
    civic: ["#777064", "#8a8274", "#5d584f"],
    warehouse: ["#4e5965", "#687480", "#303841"],
    lowrise: ["#725f52", "#876f5f", "#4d4038"]
  };
  const p = palettes[kind] || palettes.lowrise;
  g.fillStyle = fire ? "#27211d" : p[0];
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = fire ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.055)";
  for (let y = 0; y < 128; y += kind === "warehouse" ? 18 : 14) g.fillRect(0, y, 128, 1);
  for (let x = 0; x < 128; x += kind === "warehouse" ? 22 : 16) g.fillRect(x, 0, 1, 128);
  g.fillStyle = fire ? "rgba(0,0,0,0.38)" : p[1];
  for (let y = 10; y < 128; y += 22) {
    for (let x = 8; x < 128; x += 24) {
      if (kind === "warehouse") g.fillRect(x, y, 14, 4);
      else g.fillRect(x, y, 8, 9);
    }
  }
  g.fillStyle = fire ? "rgba(20,10,4,0.45)" : "rgba(0,0,0,0.13)";
  for (let i = 0; i < 48; i += 1) {
    const x = Math.floor(hash01(i, 0, 280) * 128);
    const y = Math.floor(hash01(i, 0, 281) * 128);
    g.fillRect(x, y, 1 + Math.floor(hash01(i, 0, 282) * 3), 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(kind === "warehouse" ? 1.2 : 1.6, 2.4);
  tex.anisotropy = 4;
  return tex;
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

function buildingRenderFootprint(x, y, w, d, height) {
  const cx = x + w / 2;
  const cz = y + d / 2;
  const heightSpan = height > 4.5 ? 1.55 : height > 3.1 ? 1.32 : 1.05;
  const targetW = Math.min(w + 0.34, Math.max(w * 0.96, heightSpan));
  const targetD = Math.min(d + 0.34, Math.max(d * 0.96, heightSpan));
  return [cx - targetW / 2, cz - targetD / 2, targetW, targetD];
}

export function buildingAvoidanceRects(scenario) {
  return scenarioBuildingEntries(scenario).map((b) => {
    const [x, y, w, d] = b.footprint;
    const profile = buildingProfile(b.kind);
    const h = profile.minH + hash01(x, y, 130) * (profile.maxH - profile.minH);
    const [rx, rz, rw, rd] = buildingRenderFootprint(x, y, w, d, h);
    return { x: rx, z: rz, w: rw, d: rd };
  });
}

function addBuildingWindows(group, footprint, height, damage, floors, windowMat) {
  if (damage > 0.72 || height < 0.55) return;
  const [x, y, w, d] = footprint;
  const usableFloors = Math.max(1, Math.min(floors, Math.floor(height / 0.28)));
  const colsX = Math.max(1, Math.min(5, Math.floor(w * 1.5)));
  const colsZ = Math.max(1, Math.min(5, Math.floor(d * 1.5)));
  const addPane = (px, py, pz, rotY, sx = 0.09) => {
    if (hash01(px * 3, pz * 3, Math.round(py * 10)) < damage * 0.45) return;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(sx * 1.15, 0.12), windowMat);
    pane.position.set(px, py, pz);
    pane.rotation.y = rotY;
    group.add(pane);
  };

  for (let floor = 1; floor <= usableFloors; floor += 1) {
    const py = Math.min(height - 0.16, 0.22 + floor * (height / (usableFloors + 1)));
    for (let i = 0; i < colsX; i += 1) {
      const px = x + ((i + 1) / (colsX + 1)) * w;
      addPane(px, py, y - 0.006, 0);
      addPane(px, py, y + d + 0.006, Math.PI);
    }
    for (let i = 0; i < colsZ; i += 1) {
      const pz = y + ((i + 1) / (colsZ + 1)) * d;
      addPane(x - 0.006, py, pz, Math.PI / 2);
      addPane(x + w + 0.006, py, pz, -Math.PI / 2);
    }
  }
}

function addBuildingRubble(group, footprint, damage, rubbleMat) {
  if (damage < 0.28) return;
  const [x, y, w, d] = footprint;
  const count = Math.min(18, Math.max(4, Math.floor(w * d * (3 + damage * 3))));
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

function addRooftopDetails(group, footprint, height, damage, mats) {
  if (height < 1.1 || damage > 0.82) return;
  const [x, y, w, d] = footprint;
  const cx = x + w / 2;
  const cz = y + d / 2;
  const roofY = height + 0.12;
  const ventMat = mats.vent;
  const railMat = mats.rail;
  const tankMat = mats.tank;

  const units = Math.min(3, Math.max(1, Math.floor(w * d * 0.25)));
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

function scenarioBuildingEntries(scenario) {
  const explicit = get3DBuildings(scenario).map((b) => ({ ...b, synthetic: false }));
  const [cols, rows] = scenario.map.size;
  const occupied = new Set();
  const markRect = (x, y, w = 1, h = 1, pad = 0) => {
    for (let dx = -pad; dx < w + pad; dx += 1) {
      for (let dy = -pad; dy < h + pad; dy += 1) {
        occupied.add(`${x + dx},${y + dy}`);
      }
    }
  };

  const roadCells = computeRoadCells(scenario);
  for (const key of roadCells) occupied.add(key);
  if (scenario.map.base) markRect(scenario.map.base[0], scenario.map.base[1], 1, 1, 2);
  for (const v of scenario.victims || []) markRect(v.location[0], v.location[1], 1, 1, 1);
  for (const b of scenario.map.blocked_cells || []) markRect(b.location[0], b.location[1], 1, 1, 1);
  for (const t of get3DTerrain(scenario)) {
    if (t.kind === "water" || t.kind === "grass" || t.kind === "plaza") {
      const [x, y, w, h] = t.footprint;
      markRect(x, y, w, h, 0);
    }
  }
  for (const b of explicit) {
    const [x, y, w, h] = b.footprint;
    markRect(x, y, w, h, 1);
  }

  const infill = [];
  const target = Math.min(36, Math.max(10, Math.floor((cols * rows) / 42)));
  for (let y = 1; y < rows - 1 && infill.length < target; y += 1) {
    for (let x = 1; x < cols - 1 && infill.length < target; x += 1) {
      if (occupied.has(`${x},${y}`)) continue;
      const r = hash01(x, y, 210);
      if (r > 0.2) continue;
      const wider = x < cols - 2 && !occupied.has(`${x + 1},${y}`) && hash01(x, y, 211) > 0.58;
      const deeper = y < rows - 2 && !occupied.has(`${x},${y + 1}`) && !wider && hash01(x, y, 212) > 0.62;
      const w = wider ? 2 : 1;
      const h = deeper ? 2 : 1;
      if (wider && occupied.has(`${x + 1},${y}`)) continue;
      if (deeper && occupied.has(`${x},${y + 1}`)) continue;
      const kindRoll = hash01(x, y, 213);
      const kind = kindRoll < 0.34 ? "lowrise" : kindRoll < 0.62 ? "apartment" : kindRoll < 0.82 ? "civic" : "warehouse";
      infill.push({
        id: `INF-${x}-${y}`,
        kind,
        footprint: [x, y, w, h],
        synthetic: true
      });
      markRect(x, y, w, h, 1);
    }
  }

  return explicit.concat(infill);
}

function buildScenarioBuildings3D(scenario) {
  const buildings = scenarioBuildingEntries(scenario);
  if (!buildings.length) return;

  const group = new THREE.Group();
  group.name = "scenario-buildings";
  const riskZones = scenario.map.risk_zones || [];
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xa9d6e5, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
  const sootMat = new THREE.MeshBasicMaterial({ color: 0x050404, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x51483e, roughness: 0.98, metalness: 0.03 });
  const detailMats = {
    vent: new THREE.MeshStandardMaterial({ color: 0x303841, roughness: 0.78, metalness: 0.35 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.7, metalness: 0.45 }),
    tank: new THREE.MeshStandardMaterial({ color: 0x48525d, roughness: 0.62, metalness: 0.55 }),
    shop: new THREE.MeshBasicMaterial({ color: 0x8fb6c8, transparent: true, opacity: 0.38, side: THREE.DoubleSide }),
    awning: new THREE.MeshStandardMaterial({ color: 0x6d2b2b, roughness: 0.82, metalness: 0.04 }),
    crack: new THREE.MeshBasicMaterial({ color: 0x090909, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    soot: new THREE.MeshBasicMaterial({ color: 0x040302, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide })
  };
  const facadeTexCache = new Map();
  const roofMatCache = new Map();
  const wallMatCache = new Map();

  const matFor = (key, color, damage, fire, kind = "lowrise") => {
    const cacheKey = `${key}-${color}-${Math.round(damage * 10)}-${fire ? 1 : 0}`;
    const cache = key === "roof" ? roofMatCache : wallMatCache;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const c = new THREE.Color(color);
    c.multiplyScalar(fire ? 0.45 : damage > 0.55 ? 0.58 : damage > 0.25 ? 0.75 : 1);
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.92,
      metalness: 0.04,
      emissive: fire ? 0x1a0803 : 0x000000,
      emissiveIntensity: fire ? 0.25 : 0
    });
    if (key === "wall") {
      const texKey = `${kind}-${fire ? "fire" : "base"}`;
      if (!facadeTexCache.has(texKey)) facadeTexCache.set(texKey, makeFacadeTexture(kind, fire));
      mat.map = facadeTexCache.get(texKey);
    }
    cache.set(cacheKey, mat);
    return mat;
  };

  for (const b of buildings) {
    const [x, y, w, d] = b.footprint;
    if (w <= 0 || d <= 0) continue;
    const profile = buildingProfile(b.kind);
    const cx = x + w / 2;
    const cz = y + d / 2;
    const risk = nearestRiskKind(cx, cz, riskZones);
    const damage = risk.damage;
    const fire = risk.kind === "fire" && damage > 0.18;
    const collapsed = risk.kind === "collapse" && damage > 0.58;
    const heightSeed = hash01(x, y, 130);
    let height = profile.minH + heightSeed * (profile.maxH - profile.minH);
    if (collapsed) height *= 0.32 + hash01(x, y, 131) * 0.22;
    else if (damage > 0.35) height *= 0.72 + hash01(x, y, 132) * 0.16;

    const footprint = buildingRenderFootprint(x, y, w, d, height);
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(footprint[2], height, footprint[3]),
      matFor("wall", profile.color, damage, fire, b.kind)
    );
    shell.position.set(cx, height / 2 + 0.025, cz);
    if (damage > 0.32 && !collapsed) {
      shell.rotation.x = (hash01(x, y, 133) - 0.5) * damage * 0.18;
      shell.rotation.z = (hash01(x, y, 134) - 0.5) * damage * 0.18;
    }
    group.add(shell);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(footprint[2] * 1.02, 0.045, footprint[3] * 1.02),
      matFor("roof", profile.roof, damage, fire, b.kind)
    );
    roof.position.set(cx, height + 0.055, cz);
    roof.rotation.copy(shell.rotation);
    group.add(roof);

    addBuildingWindows(group, footprint, height, damage, profile.floors, windowMat);
    addRooftopDetails(group, footprint, height, damage, detailMats);
    addStreetLevelDetails(group, footprint, height, damage, b.kind, detailMats);
    addDamageDecals(group, footprint, height, damage, fire, detailMats);
    addBuildingRubble(group, footprint, Math.max(damage, collapsed ? 0.8 : 0), rubbleMat);

    if (fire) {
      const soot = new THREE.Mesh(new THREE.PlaneGeometry(footprint[2] * 0.65, Math.max(0.35, height * 0.65)), sootMat);
      soot.position.set(cx, Math.max(0.25, height * 0.55), y + 0.07);
      soot.rotation.x = 0;
      group.add(soot);
    }
  }

  world.scene.add(group);
  world.scenarioBuildingsGroup = group;
}

function addFireSmoke(scenario) {
  const fireZones = (scenario?.map?.risk_zones || []).filter((z) => z.type === "fire");
  if (!fireZones.length) return;
  world.smokePuffs = world.smokePuffs || [];
  world.fireGlows = world.fireGlows || [];

  for (const z of fireZones) {
    const baseX = z.center[0] + 0.5;
    const baseZ = z.center[1] + 0.5;

    const glow = new THREE.PointLight(0xff6020, 2.0, 9, 1.8);
    glow.position.set(baseX, 0.6, baseZ);
    world.scene.add(glow);
    world.fireGlows.push(glow);

    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8c30, transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    );
    ember.position.set(baseX, 0.25, baseZ);
    world.scene.add(ember);
    world.fireGlows.push({ ember, _isEmber: true, x: baseX, z: baseZ });

    const puffCount = 12;
    const plumeHeight = 14;
    for (let i = 0; i < puffCount; i += 1) {
      const phase = i / puffCount;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x1f1c19, transparent: true, opacity: 0.7, depthWrite: false, fog: true })
      );
      sphere.position.set(baseX, 0.6 + phase * plumeHeight, baseZ);
      world.scene.add(sphere);
      world.smokePuffs.push({ mesh: sphere, baseX, baseZ, baseY: 0.6, height: plumeHeight, phase, zoneId: z.id });
    }
  }
}

function updateSmokeAndGlows(t) {
  if (world.smokePuffs) {
    const ageNorm = (t * 0.045) % 1;
    for (const p of world.smokePuffs) {
      const localT = (p.phase + ageNorm) % 1;
      p.mesh.position.y = p.baseY + localT * p.height;
      p.mesh.scale.setScalar(0.65 + localT * 1.8);
      p.mesh.position.x = p.baseX + Math.sin(t * 0.6 + p.phase * 6) * localT * 0.7;
      p.mesh.position.z = p.baseZ + Math.cos(t * 0.55 + p.phase * 5) * localT * 0.7;
      const mat = p.mesh.material;
      if (mat) {
        const dark = 0.12 - localT * 0.04;
        mat.color.setRGB(Math.max(0.04, dark + 0.04), Math.max(0.03, dark + 0.02), Math.max(0.03, dark));
        mat.opacity = Math.max(0, 0.75 - localT * 0.7);
      }
    }
  }
  if (world.fireGlows) {
    for (const g of world.fireGlows) {
      if (g._isEmber) {
        const flicker = 0.7 + Math.sin(t * 9 + g.x) * 0.3 + Math.sin(t * 14 + g.z) * 0.2;
        g.ember.scale.setScalar(Math.max(0.4, flicker));
        const mat = g.ember.material;
        if (mat) mat.opacity = 0.6 + Math.sin(t * 11) * 0.25;
      } else if (g.intensity !== undefined) {
        g.intensity = 1.6 + Math.sin(t * 8 + g.position.x) * 0.5 + Math.sin(t * 13 + g.position.z) * 0.3;
      }
    }
  }
}

function addStreetFurniture(scenario) {
  const [cols, rows] = scenario.map.size;
  const roadCells = computeRoadCells(scenario);
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

  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.85, metalness: 0.3 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x32363c, roughness: 0.8, metalness: 0.4 });
  for (const y of hLines) {
    for (const x of vLines) {
      if (x === 0 || x === cols - 1 || y === 0 || y === rows - 1) continue;
      const damage = cellDamageLevel(x, y, riskZones);
      for (const ox of [-1, 1]) {
        for (const oz of [-1, 1]) {
          const lamp = new THREE.Group();
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.4, 8), postMat);
          post.position.y = 0.7;
          lamp.add(post);
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 6), armMat);
          arm.rotation.z = Math.PI / 2;
          arm.position.set(-ox * 0.12, 1.35, 0);
          lamp.add(arm);
          const isLit = damage < 0.4 && hash01(x, y, 50 + ox + oz * 2) > 0.15;
          const lampMat = new THREE.MeshStandardMaterial({
            color: isLit ? 0xffe9b0 : 0x1a1614,
            emissive: isLit ? 0xffd080 : 0x000000,
            emissiveIntensity: isLit ? 0.9 : 0,
            roughness: 0.7
          });
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.18), lampMat);
          head.position.set(-ox * 0.24, 1.32, 0);
          lamp.add(head);
          if (isLit) {
            const light = new THREE.PointLight(0xffd080, 0.6, 4.5);
            light.position.set(-ox * 0.24, 1.32, 0);
            lamp.add(light);
          }
          lamp.position.set(x + 0.5 + ox * 0.55, 0, y + 0.5 + oz * 0.55);
          if (damage > 0.45) {
            lamp.rotation.z = (hash01(x, y, 51 + ox + oz * 2) - 0.5) * 0.6;
            lamp.rotation.x = (hash01(x, y, 52 + ox + oz * 2) - 0.5) * 0.3;
          }
          world.scene.add(lamp);
        }
      }
    }
  }

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d4a25, roughness: 0.9 });
  const fallenLeafMat = new THREE.MeshStandardMaterial({ color: 0x4a3522, roughness: 0.95 });
  for (const patch of get3DTerrain(scenario)) {
    if (patch.kind !== "grass") continue;
    const [px, py, pw, ph] = patch.footprint;
    const treeCount = Math.max(1, Math.floor(pw * ph * 0.5));
    for (let i = 0; i < treeCount; i += 1) {
      const tx = px + 0.3 + hash01(px + i, py, 41) * (pw - 0.6);
      const tz = py + 0.3 + hash01(px, py + i, 42) * (ph - 0.6);
      const damage = cellDamageLevel(Math.floor(tx), Math.floor(tz), riskZones);
      const fallen = damage > 0.4 && hash01(tx, tz, 44) > 0.4;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), trunkMat);
      trunk.position.y = 0.25;
      tree.add(trunk);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 8), fallen ? fallenLeafMat : leafMat);
      leaves.position.y = 0.7;
      tree.add(leaves);
      tree.position.set(tx, 0, tz);
      tree.scale.setScalar(0.8 + hash01(tx, tz, 43) * 0.6);
      if (fallen) tree.rotation.z = (Math.PI / 2) * (hash01(tx, tz, 45) > 0.5 ? 1 : -1) * 0.85;
      world.scene.add(tree);
    }
  }

  const hydrantMat = new THREE.MeshStandardMaterial({ color: 0x9a2820, roughness: 0.6, metalness: 0.2 });
  for (let i = 0; i < 14; i += 1) {
    const cx = Math.floor(hash01(i, 7, 61) * cols);
    const cz = Math.floor(hash01(i, 11, 62) * rows);
    if (!roadCells.has(`${cx},${cz}`)) continue;
    const hydrant = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.28, 8), hydrantMat);
    body.position.y = 0.14;
    hydrant.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.07, 8), hydrantMat);
    top.position.y = 0.32;
    hydrant.add(top);
    hydrant.position.set(cx + 0.92, 0, cz + 0.92);
    world.scene.add(hydrant);
  }
}

function addUrbanStreetProps(scenario) {
  const roads = get3DRoads(scenario);
  if (!roads.length) return;

  const group = new THREE.Group();
  group.name = "urban-street-props";
  const carBodyMats = [
    new THREE.MeshStandardMaterial({ color: 0x26384a, roughness: 0.72, metalness: 0.24 }),
    new THREE.MeshStandardMaterial({ color: 0x3b342f, roughness: 0.8, metalness: 0.18 }),
    new THREE.MeshStandardMaterial({ color: 0x5b2b25, roughness: 0.82, metalness: 0.14 }),
    new THREE.MeshStandardMaterial({ color: 0x6f6b5a, roughness: 0.78, metalness: 0.16 })
  ];
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.45, metalness: 0.2, emissive: 0x031018, emissiveIntensity: 0.1 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.92, metalness: 0.02 });
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x554c41, roughness: 0.98, metalness: 0.02 });
  const buildingRects = buildingAvoidanceRects(scenario);
  let parked = 0;
  let debris = 0;

  const placeCar = (x, z, yaw, seed) => {
    const car = new THREE.Group();
    const bodyMat = carBodyMats[Math.floor(hash01(seed, z, 270) * carBodyMats.length) % carBodyMats.length];
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.58), bodyMat);
    body.position.y = 0.12;
    car.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.26), glassMat);
    cabin.position.set(0, 0.25, -0.03);
    car.add(cabin);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 8), tireMat);
        tire.rotation.z = Math.PI / 2;
        tire.position.set(sx * 0.18, 0.055, sz * 0.22);
        car.add(tire);
      }
    }
    car.position.set(x, 0, z);
    car.rotation.y = yaw;
    if (hash01(seed, z, 271) < 0.22) {
      car.rotation.z = (hash01(seed, z, 272) - 0.5) * 0.22;
    }
    group.add(car);
  };

  for (const road of roads) {
    if (parked > 34 && debris > 40) break;
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
      if (len < 2) continue;
      const yaw = Math.atan2(dx, dz);
      const perpX = -dz / len;
      const perpZ = dx / len;
      const step = 2.2;
      const count = Math.floor(len / step);
      for (let k = 1; k < count; k += 1) {
        const t = k / count;
        const px = ax + dx * t;
        const pz = az + dz * t;
        const side = hash01(px, pz, 273) > 0.5 ? 1 : -1;
        const curbOffset = width / 2 + 0.28;
        const propX = px + perpX * curbOffset * side;
        const propZ = pz + perpZ * curbOffset * side;
        if (pointNearBuilding(propX, propZ, buildingRects, 0.42)) continue;
        if (parked < 34 && hash01(px, pz, 274) < 0.26) {
          placeCar(propX, propZ, yaw, px + pz);
          parked += 1;
        } else if (debris < 40 && hash01(px, pz, 275) < 0.18) {
          const chunk = new THREE.Mesh(
            new THREE.BoxGeometry(0.08 + hash01(px, pz, 276) * 0.16, 0.035 + hash01(px, pz, 277) * 0.06, 0.08 + hash01(px, pz, 278) * 0.16),
            debrisMat
          );
          chunk.position.set(propX, 0.055, propZ);
          chunk.rotation.y = hash01(px, pz, 279) * Math.PI * 2;
          group.add(chunk);
          debris += 1;
        }
      }
    }
  }

  world.scene.add(group);
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

  // Ground — neon grid placeholder, swapped to concrete after assets load
  const gridTex = makeGridTexture(512, cols, rows, s3.gridTex);
  const gm = s3.gridMat;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(cols, rows),
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

  // Sky-dome — smoky disaster gradient for the FPV horizon
  const skyTex = makeGradientSkyTexture(512, s3.skyStops);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  world.scene.add(sky);

  // Scenario-driven world detail. These helpers are guarded so legacy
  // scenarios without terrain/roads still render the base FPV scene.
  addTerrainPatches3D(scenario);
  addCityGroundDetail(scenario);
  buildScenarioBuildings3D(scenario);

  // Base marker
  const [bx, by] = scenario.map.base;
  const base = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffe44d,
      emissive: 0xffe44d,
      emissiveIntensity: 0.9,
      roughness: 0.4
    })
  );
  pad.position.y = 0.04;
  base.add(pad);
  const beacon = new THREE.PointLight(0xffe44d, 0.9, 8);
  beacon.position.y = 1.5;
  base.add(beacon);
  base.position.set(bx + 0.5, 0, by + 0.5);
  world.scene.add(base);
  world.baseMesh = base;

  // Blockades
  for (const blk of scenario.map.blocked_cells) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.85, metalness: 0.1 })
    );
    mesh.position.set(blk.location[0] + 0.5, 0.6, blk.location[1] + 0.5);
    world.scene.add(mesh);
    world.blockadeMeshes.set(blk.id, mesh);
  }

  // Risk zones — subtle: thin ground ring + a small atmospheric column (no harsh disk)
  for (const zone of scenario.map.risk_zones) {
    const isFire = zone.type === "fire";
    const baseColor = isFire ? 0xff7a3c : 0xa887ff;

    const grp = new THREE.Group();
    grp.position.set(zone.center[0] + 0.5, 0, zone.center[1] + 0.5);

    // Thin ground ring (annulus) — like a survey marker
    const ringInner = Math.max(0.1, zone.radius - 0.18);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringInner, zone.radius, 64),
      new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.25, side: THREE.DoubleSide, fog: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    grp.add(ring);

    // Tiny core glow at center — vertical pillar-of-light implied
    const halo = new THREE.PointLight(baseColor, isFire ? 0.85 : 0.45, zone.radius * 3.5);
    halo.position.y = 1.4;
    grp.add(halo);

    // For fire: a thin vertical "smoke column" billboard
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

  // Victims
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
  addUrbanStreetProps(scenario);

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(s3.rendererClear, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = s3.toneExposure ?? 1.4;

    const camera = new THREE.PerspectiveCamera(72, 16 / 10, 0.1, 200);
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

function templateForBuildingKind(kind, buildingTemplates) {
  const byKind = {
    apartment: 0,
    civic: 1,
    lowrise: 2,
    warehouse: 3
  };
  const idx = byKind[kind] ?? 0;
  return buildingTemplates[idx % buildingTemplates.length] || buildingTemplates[0];
}

function scaleAssetBuildingToFootprint(obj, footprint, targetHeight) {
  const [, , w, d] = footprint;
  obj.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const sx = Math.max(0.01, (w - 0.14) / Math.max(size.x, 0.01));
  const sz = Math.max(0.01, (d - 0.14) / Math.max(size.z, 0.01));
  const sy = Math.max(0.01, targetHeight / Math.max(size.y, 0.01));
  obj.scale.x *= sx;
  obj.scale.y *= sy;
  obj.scale.z *= sz;
}

function upgradeScenarioBuildingsToAssets(scenario, buildingTemplates, palette = {}) {
  const buildings = scenarioBuildingEntries(scenario);
  if (!buildings.length || !buildingTemplates?.length) return;

  if (world.scenarioBuildingsGroup) {
    world.scene.remove(world.scenarioBuildingsGroup);
    disposeObject(world.scenarioBuildingsGroup);
    world.scenarioBuildingsGroup = null;
  }

  const group = new THREE.Group();
  group.name = "scenario-buildings-assets";
  const riskZones = scenario.map.risk_zones || [];
  const rubbleMat = palette.rubbleMat || new THREE.MeshStandardMaterial({ color: 0x51483e, roughness: 0.98, metalness: 0.03 });
  const detailMats = {
    vent: new THREE.MeshStandardMaterial({ color: 0x303841, roughness: 0.78, metalness: 0.35 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.7, metalness: 0.45 }),
    tank: new THREE.MeshStandardMaterial({ color: 0x48525d, roughness: 0.62, metalness: 0.55 }),
    shop: new THREE.MeshBasicMaterial({ color: 0x8fb6c8, transparent: true, opacity: 0.38, side: THREE.DoubleSide }),
    awning: new THREE.MeshStandardMaterial({ color: 0x6d2b2b, roughness: 0.82, metalness: 0.04 }),
    crack: new THREE.MeshBasicMaterial({ color: 0x090909, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    soot: new THREE.MeshBasicMaterial({ color: 0x040302, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide })
  };

  for (const b of buildings) {
    const [x, y, w, d] = b.footprint;
    if (w <= 0 || d <= 0) continue;
    const profile = buildingProfile(b.kind);
    const cx = x + w / 2;
    const cz = y + d / 2;
    const risk = nearestRiskKind(cx, cz, riskZones);
    const damage = risk.damage;
    const fire = risk.kind === "fire" && damage > 0.18;
    const collapsed = risk.kind === "collapse" && damage > 0.58;
    let targetHeight = profile.minH + hash01(x, y, 130) * (profile.maxH - profile.minH);
    if (collapsed) targetHeight *= 0.34 + hash01(x, y, 131) * 0.2;
    else if (damage > 0.35) targetHeight *= 0.74 + hash01(x, y, 132) * 0.14;

    const footprint = buildingRenderFootprint(x, y, w, d, targetHeight);
    const template = templateForBuildingKind(b.kind, buildingTemplates);
    const asset = template.clone(true);
    scaleAssetBuildingToFootprint(asset, footprint, targetHeight);
    asset.position.set(cx, groundedY(asset) + 0.025, cz);
    asset.rotation.y = Math.floor(hash01(x, y, 136) * 4) * (Math.PI / 2);
    if (damage > 0.32 && !collapsed) {
      asset.rotation.x = (hash01(x, y, 133) - 0.5) * damage * 0.16;
      asset.rotation.z = (hash01(x, y, 134) - 0.5) * damage * 0.16;
    }

    asset.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      node.material = mats.map((mat) => {
        const next = mat.clone();
        if (next.color) {
          const tint = fire ? 0.45 : damage > 0.55 ? 0.62 : damage > 0.25 ? 0.78 : 1;
          next.color.multiplyScalar(tint);
        }
        if (next.emissive && fire) {
          next.emissive.setHex(0x1a0803);
          next.emissiveIntensity = 0.18;
        }
        return next;
      });
      if (mats.length === 1) node.material = node.material[0];
    });

    group.add(asset);

    addRooftopDetails(group, footprint, targetHeight, damage, detailMats);
    addStreetLevelDetails(group, footprint, targetHeight, damage, b.kind, detailMats);
    addDamageDecals(group, footprint, targetHeight, damage, fire, detailMats);
    addBuildingRubble(group, footprint, Math.max(damage, collapsed ? 0.8 : 0), rubbleMat);
  }

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

  const fbxLoader = new FBXLoader();

  const [
    aptGlb, facadeGlb, mansionGlb, multiGlb,
    rubbleGlb, signsGlb, survivorGlb, taxiGlb,
    cBase, cNorm, cRough,
    bBase, bNorm, bRough,
    pBase, pNorm, pRough,
    dBase, dNorm, dRough,
    c2Base, c2Norm, c2Rough,
    rBase, rNorm, rRough,
    wBase, wNorm, wRough,
    mBase, mMetal, mNorm, mRough,
    heroFbx, heroColor, heroBumpNm
  ] = await Promise.all([
    loader.loadAsync(`${M}building-apartment.glb`),
    loader.loadAsync(`${M}building-facade.glb`),
    loader.loadAsync(`${M}building-mansion.glb`),
    loader.loadAsync(`${M}building-multistory.glb`),
    loader.loadAsync(`${M}rubble-large.glb`),
    loader.loadAsync(`${M}street-signs.glb`),
    loader.loadAsync(`${M}survivor.glb`),
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
    fbxLoader.loadAsync("/models-fbx/AM165_001_VRay.fbx").catch((err) => { console.warn("[hero FBX] load failed:", err); return null; }),
    texLoader.loadAsync("/models-fbx/AM165_001_color.jpg").catch(() => null),
    texLoader.loadAsync("/models-fbx/AM165_001_bump_nm.jpg").catch(() => null)
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

  upgradeScenarioBuildingsToAssets(scenario, buildingTemplates, { rubbleMat });

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
    fitToSize(rubble, 1.4);
    rubble.position.set(blk.location[0] + 0.5, groundedY(rubble), blk.location[1] + 0.5);
    rubble.rotation.y = (blk.location[0] * 13 + blk.location[1] * 7) * 0.31;
    world.scene.add(rubble);
    world.blockadeMeshes.set(blk.id, rubble);
  }

  // Swap victims for survivor GLB (lying / posed)
  for (const v of scenario.victims) {
    const old = world.victimMeshes.get(v.id);
    if (old?.group) {
      world.scene.remove(old.group);
    }
    const survivor = survivorGlb.scene.clone(true);
    fitToSize(survivor, 0.9);
    const grp = new THREE.Group();
    grp.add(survivor);
    survivor.rotation.x = -Math.PI / 2;
    survivor.rotation.z = (v.id.charCodeAt(1) || 0) * 0.7;
    survivor.position.y = 0.05;
    const flare = new THREE.PointLight(0xff6666, 0.7, 4);
    flare.position.y = 0.4;
    grp.add(flare);
    grp.position.set(v.location[0] + 0.5, 0, v.location[1] + 0.5);

    const meshes = [];
    survivor.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = obj.material.clone();
        if (!obj.material.emissive) obj.material.emissive = new THREE.Color(0x000000);
        meshes.push(obj);
      }
    });
    world.scene.add(grp);
    world.victimMeshes.set(v.id, { group: grp, flare, meshes, isAsset: true });
  }

  // Scatter scenery — also reuse the rubble GLB for small debris piles
  scatterScenery(scenario, buildingTemplates, taxiGlb.scene, signsGlb.scene, rubbleGlb.scene, { rubbleMat, woodMat, rustMat });

  // Single hero landmark from the AM165 FBX at city center
  placeHeroProp(scenario, heroFbx, heroColor, heroBumpNm);

  // Texture the ground — use the second concrete variant so it reads distinct from building walls
  if (world.groundGrid) {
    const groundBase = c2Base.clone();
    const groundNorm = c2Norm.clone();
    const groundRough = c2Rough.clone();
    for (const tex of [groundBase, groundNorm, groundRough]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(12, 12);
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

function placeHeroProp(scenario, fbx, colorTex, bumpTex) {
  if (!fbx) return;
  if (colorTex) colorTex.colorSpace = THREE.SRGBColorSpace;
  fbx.traverse((obj) => {
    if (!obj.isMesh) return;
    const next = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.05
    });
    if (colorTex) next.map = colorTex;
    if (bumpTex) next.normalMap = bumpTex;
    obj.material = next;
  });
  fitToSize(fbx, 3.5);
  const [cols, rows] = scenario.map.size;
  fbx.position.set(cols / 2, groundedY(fbx), rows / 2);
  fbx.rotation.y = Math.PI / 4;
  world.scene.add(fbx);
  world.heroProp = fbx;
}

function scatterScenery(scenario, buildingTemplates, taxiSrc, signsSrc, rubbleSrc, palette = {}) {
  const { rubbleMat, woodMat, rustMat } = palette;
  const [cols, rows] = scenario.map.size;
  const occupied = new Set();
  const mark = (x, y, r = 1) => {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        occupied.add(`${x + dx},${y + dy}`);
      }
    }
  };
  mark(scenario.map.base[0], scenario.map.base[1], 2);
  for (const v of scenario.victims) mark(v.location[0], v.location[1], 2);
  for (const b of scenario.map.blocked_cells) mark(b.location[0], b.location[1], 1);
  for (const b of scenario.map.buildings || []) {
    const [bx, by, bw, bh] = b.footprint;
    for (let dx = 0; dx < bw; dx += 1) {
      for (let dy = 0; dy < bh; dy += 1) {
        mark(bx + dx, by + dy, 0);
      }
    }
  }
  for (const z of scenario.map.risk_zones) {
    const r = Math.ceil(z.radius);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (dx * dx + dy * dy <= z.radius * z.radius) {
          occupied.add(`${z.center[0] + dx},${z.center[1] + dy}`);
        }
      }
    }
  }

  const hash = (x, y) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5) % 1;
  const cardinalRot = (x, y) => Math.floor(hash(x, y + 5) * 4) * (Math.PI / 2);

  // Road cells (open spine every 5th row / 6th col) — skip placement here so streets stay clear
  const isRoad = (x, y) => (y % 5 === 2) || (x % 6 === 2);

  for (let x = 1; x < cols - 1; x += 1) {
    for (let y = 1; y < rows - 1; y += 1) {
      if (occupied.has(`${x},${y}`)) continue;
      if (isRoad(x, y)) {
        // Street props: lower-frequency taxis and signs in roads
        const rr = hash(x + 7, y - 3);
        if (rr < 0.04 && taxiSrc) {
          const taxi = taxiSrc.clone(true);
          fitToSize(taxi, 0.7);
          taxi.position.set(x + 0.5, groundedY(taxi), y + 0.5);
          taxi.rotation.y = cardinalRot(x + 1, y);
          // Burned/abandoned hulks get the rust material; ~40% chance
          if (rustMat && hash(x + 11, y - 1) < 0.4) {
            taxi.traverse((obj) => { if (obj.isMesh) obj.material = rustMat; });
          }
          world.scene.add(taxi);
        } else if (rr < 0.07 && signsSrc) {
          const sign = signsSrc.clone(true);
          fitToSize(sign, 0.5);
          sign.position.set(x + 0.5, groundedY(sign), y + 0.5);
          sign.rotation.y = cardinalRot(x + 2, y);
          // Weathered signs: ~30% rusted
          if (rustMat && hash(x + 13, y - 2) < 0.3) {
            sign.traverse((obj) => { if (obj.isMesh) obj.material = rustMat; });
          }
          world.scene.add(sign);
        }
        continue;
      }
      const r = hash(x, y);
      if (r < 0.32 && !(scenario.map.buildings || []).length) {
        const idx = Math.floor(hash(x + 3, y - 2) * buildingTemplates.length);
        const b = buildingTemplates[idx].clone(true);
        b.position.set(x + 0.5, groundedY(b), y + 0.5);
        b.rotation.y = cardinalRot(x, y);
        world.scene.add(b);
        mark(x, y, 1);
      } else if (r < 0.42 && rubbleSrc) {
        // Small debris pile in vacant lots
        const debris = rubbleSrc.clone(true);
        fitToSize(debris, 0.6 + hash(x, y + 8) * 0.4);
        debris.position.set(x + 0.5, groundedY(debris), y + 0.5);
        debris.rotation.y = hash(x + 5, y) * Math.PI * 2;
        if (rubbleMat) {
          debris.traverse((obj) => { if (obj.isMesh) obj.material = rubbleMat; });
        } else {
          debris.traverse((obj) => {
            if (obj.isMesh) {
              obj.material = obj.material.clone();
              if (obj.material.color) obj.material.color.setHex(0x554840);
              obj.material.roughness = 0.95;
            }
          });
        }
        world.scene.add(debris);
      } else if (r < 0.45 && signsSrc) {
        const sign = signsSrc.clone(true);
        fitToSize(sign, 0.5);
        sign.position.set(x + 0.5, groundedY(sign), y + 0.5);
        sign.rotation.y = cardinalRot(x + 2, y);
        world.scene.add(sign);
      }
    }
  }

  if (woodMat) addWoodenScaffolding(scenario, woodMat);
}

function addWoodenScaffolding(scenario, woodMat) {
  const buildings = scenario?.tacticalBuildings;
  const hash = (x, y) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5) % 1;
  const placed = new Set();

  const placeScaffoldAt = (cx, cz, salt) => {
    const key = `${Math.round(cx * 4)},${Math.round(cz * 4)}`;
    if (placed.has(key)) return;
    placed.add(key);
    const scaffold = new THREE.Group();
    const postH = 1.5;
    const span = 0.45;
    for (const [ox, oz] of [[-span, -span], [span, -span], [span, span], [-span, span]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, postH, 0.05), woodMat);
      post.position.set(ox, postH / 2, oz);
      scaffold.add(post);
    }
    for (const yy of [postH * 0.35, postH * 0.7]) {
      const railA = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.05, 0.04, 0.04), woodMat);
      railA.position.set(0, yy, -span);
      scaffold.add(railA);
      const railB = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.05, 0.04, 0.04), woodMat);
      railB.position.set(0, yy, span);
      scaffold.add(railB);
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.05, 0.04, 0.04), woodMat);
    brace.position.set(0, postH * 0.5, -span);
    brace.rotation.z = Math.PI / 5;
    scaffold.add(brace);
    scaffold.position.set(cx, 0, cz);
    scaffold.rotation.y = hash(cx + salt, cz) * Math.PI * 2;
    world.scene.add(scaffold);
  };

  if (buildings && buildings.length) {
    const cellSize = scenario?.map?.cell_size_m ? 1 : 1;
    let count = 0;
    for (const b of buildings) {
      if (!(b.damage > 0.4)) continue;
      const cx = (b.centerX ?? b.x ?? 0) * cellSize;
      const cz = (b.centerY ?? b.y ?? 0) * cellSize;
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const offset = 0.7;
      const angle = hash(cx, cz) * Math.PI * 2;
      placeScaffoldAt(cx + Math.cos(angle) * offset, cz + Math.sin(angle) * offset, 1);
      count += 1;
      if (count >= 24) break;
    }
    if (count > 0) return;
  }

  const [cols, rows] = scenario.map.size;
  for (const z of (scenario.map.risk_zones || [])) {
    const samples = 4;
    for (let i = 0; i < samples; i += 1) {
      const a = (i / samples) * Math.PI * 2;
      const r = z.radius + 0.4;
      const cx = z.center[0] + 0.5 + Math.cos(a) * r;
      const cz = z.center[1] + 0.5 + Math.sin(a) * r;
      if (cx < 0.5 || cz < 0.5 || cx > cols - 0.5 || cz > rows - 0.5) continue;
      placeScaffoldAt(cx, cz, i * 3);
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
  updateSmokeAndGlows(t);

  for (const a of state.agents) {
    const mesh = world.agentMeshes.get(a.id);
    if (!mesh) continue;
    const prev = a.prevLocation || a.location;
    const ix = lerp(prev[0], a.location[0], frac);
    const iy = lerp(prev[1], a.location[1], frac);
    const phase = a.id.charCodeAt(0);
    let targetY;
    if (a.type === "drone") {
      targetY = 1.5 + Math.sin(t * 1.0 + phase) * 0.5 + Math.sin(t * 0.4 + phase * 0.5) * 0.25;
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
      m.group.position.y = isAlive ? Math.abs(Math.sin(t * 2)) * 0.05 : 0;
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
  world.scenarioBuildingsGroup = null;
  world.roadsGroup = null;
  world.smokePuffs = [];
  world.fireGlows = [];
  world.initialized = false;
}
