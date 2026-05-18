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
  scenarioBuildingsGroup: null,
  roadsGroup: null,
  smokePuffs: [],
  fireGlows: [],
  initialized: false,
};

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

    const puffCount = 6;
    const plumeHeight = 14;
    for (let i = 0; i < puffCount; i += 1) {
      const phase = i / puffCount;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 6, 4),
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
  for (const y of hLines) {
    for (const x of vLines) {
      if (x === 0 || x === cols - 1 || y === 0 || y === rows - 1) continue;
      if (baseX != null && Math.abs(x - baseX) <= 1 && Math.abs(y - baseY) <= 1) continue;
      const damage = cellDamageLevel(x, y, riskZones);
      /** One lamp per intersection (was two diagonals) — halves the per-frame draw count. */
      const lampPick = hash01(x, y, 70);
      const lampCorners = [[-1, -1], [1, 1], [-1, 1], [1, -1]];
      const [ox, oz] = lampCorners[Math.floor(lampPick * 4) % 4];
      {
        const lamp = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 10), postMat);
        base.position.y = 0.02;
        lamp.add(base);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.7, 10), postMat);
        post.position.y = 0.39;
        lamp.add(post);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 10), armMat);
        collar.position.y = 0.74;
        lamp.add(collar);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.14, 6), armMat);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(-ox * 0.08, 0.75, 0);
        lamp.add(arm);
        const isLit = damage < 0.4 && hash01(x, y, 50 + ox + oz * 2) > 0.15;
        const lampMat = new THREE.MeshStandardMaterial({
          color: isLit ? 0xffe9b0 : 0x1a1614,
          emissive: isLit ? 0xffd080 : 0x000000,
          emissiveIntensity: isLit ? 0.9 : 0,
          roughness: 0.7
        });
        const hood = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.045, 10, 1, true), armMat);
        hood.position.set(-ox * 0.15, 0.73, 0);
        lamp.add(hood);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 0.055, 10), lampMat);
        head.position.set(-ox * 0.15, 0.68, 0);
        lamp.add(head);
        if (isLit) {
          const light = new THREE.PointLight(0xffd080, 0.55, 3);
          light.position.set(-ox * 0.15, 0.65, 0);
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

  /** EZ-Tree generation — same procedural library used by the wildfire scene.
   *  Bounded count so per-tree CPU cost stays small for urban-quake. */
  const treePresets = ["Oak Small", "Aspen Small", "Ash Small"];
  let treeBudget = 60;
  const buildingRects = buildingAvoidanceRects(scenario);
  const roadCellSet = computeRoadCells(scenario);
  const baseXY = scenario.map.base || [-99, -99];

  const placeTree = (tx, tz, saltBase) => {
    const damage = cellDamageLevel(Math.floor(tx), Math.floor(tz), riskZones);
    const fallen = damage > 0.4 && hash01(tx, tz, saltBase + 4) > 0.4;
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
    tree.scale.setScalar(0.02 + hash01(tx, tz, saltBase + 3) * 0.015);
    tree.rotation.y = hash01(tx, tz, saltBase + 8) * Math.PI * 2;
    if (fallen) tree.rotation.z = (Math.PI / 2) * (hash01(tx, tz, saltBase + 5) > 0.5 ? 1 : -1) * 0.85;
    world.scene.add(tree);
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
      placeTree(tx, tz, 40);
      treeBudget -= 1;
      if (treeBudget <= 0) break;
    }
  }

  // Second pass: scatter on empty cells (no roads, no buildings, no base spawn pad)
  for (let cy = 1; cy < rows - 1 && treeBudget > 0; cy += 1) {
    for (let cx = 1; cx < cols - 1 && treeBudget > 0; cx += 1) {
      if (hash01(cx, cy, 360) < 0.78) continue;
      if (roadCellSet.has(`${cx},${cy}`)) continue;
      if (Math.abs(cx - baseXY[0]) <= 2 && Math.abs(cy - baseXY[1]) <= 2) continue;
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
    new THREE.SphereGeometry(50, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  world.scene.add(sky);

  // Scenario-driven world detail. These helpers are guarded so legacy
  // scenarios without terrain/roads still render the base FPV scene.
  addTerrainPatches3D(scenario);
  addCityGroundDetail(scenario);
  // Primitive building shells removed; upgradeScenarioBuildingsToAssets populates GLB clones.

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

  for (const b of buildings) {
    const [x, y, w, d] = b.footprint;
    if (w <= 0 || d <= 0) continue;
    const profile = buildingProfile(b.kind);
    const cx = x + w / 2;
    const cz = y + d / 2;
    const targetHeight = profile.minH + hash01(x, y, 130) * (profile.maxH - profile.minH);

    const footprint = buildingRenderFootprint(x, y, w, d, targetHeight);
    const template = templateForBuildingKind(b.kind, buildingTemplates);
    const asset = template.clone(true);
    scaleAssetBuildingToFootprint(asset, footprint, targetHeight);
    asset.position.set(cx, groundedY(asset) + 0.025, cz);
    asset.rotation.y = Math.floor(hash01(x, y, 136) * 4) * (Math.PI / 2);

    group.add(asset);
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
    const soldier = createInjuredSoldierInstance(soldierPrototype, 1.2);
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

  // Dress the starting area with realistic GLB clones so the spawn pad reads as a city block
  dressBaseCamp(scenario, taxiGlb.scene, signsGlb.scene, rubbleGlb.scene, { rustMat, rubbleMat });

  // Scatter decorative survivor clones in rubble / collapsed blocks (not tracked by sim)
  addInjuredProps(scenario, soldierPrototype);

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

      const soldier = createInjuredSoldierInstance(soldierPrototype, 1.2);
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
