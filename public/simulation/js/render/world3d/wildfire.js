/**
 * Wildfire preset: procedural meadow + EZ-Tree + tactical FPV (drones / UGV, HUD + fleet selector).
 */
import * as THREE from "three";
import { PRESET_VISUAL, setCurrentScenePreset } from "../../config/presets.js";
import { lerp } from "../../sim/math.js";
import {
  buildAgentSelector,
  teardownAgentSelector,
  povs,
  ui3d,
  currentTargetFor,
  currentTargetIdFor,
} from "./tactical-pov-shell.js";
import {
  tacticalFpvPhaseSeed,
  tacticalFpvForwardVector,
  tacticalFpvLookDistanceWorld,
  tacticalFpvEyeWorldPosition,
  tacticalFpvAltitudeUrbanUnits,
  lerpAngleDeg,
} from "./fleet-fpv-kit.js";
import { createAgentMesh } from "./fleet-agents-mesh.js";
import { emitToast } from "../../ui/toast.js";
import {
  grassWindTimeUniform,
  createSkyDomeMesh,
  createWildfireMeadowRoot,
  FOG_COLOR_HEX,
  MEADOW_FOG_FAR,
  MEADOW_FOG_NEAR,
  SKY_BOTTOM,
  WILDFIRE_LIGHT_LEGACY_SCALE,
  wildfireBurnAvoidanceRects,
  makeMeadowGridToWorldXZ,
  meadowAverageMetresPerCell,
} from "./wildfire-meadow-scene.js";

/** @type {THREE.Scene | null} */
let wfScene = null;
/** @type {number} */
let wfBootGeneration = 0;

/** EZ-Tree instances currently bound (wind animation). */
let wfEzTrees = [];
/** @type {THREE.Group | null} */
let wfForestRoot = null;

let wfCols = 30;
let wfRows = 30;
/** @type {(ix: number, iy: number) => { x: number; z: number }} */
let wfMeadowGridToXZ = (_ix, _iy) => ({ x: 0, z: 0 });
let wfPitchScale = 8;

/** @type {Map<string, THREE.Group>} */
const wfAgentMeshes = new Map();

function povColumnEl() {
  return document.querySelector(".map-pov-col");
}

function decorateWildfirePovChrome() {
  const col = povColumnEl();
  if (!col) return;
  col.classList.add("wildfire-splat-active");

  const kicker = col.querySelector(".vp-head .kicker");
  if (kicker) kicker.textContent = "M01 · Meadow theatre · tactical FPV";

  const tag = col.querySelector(".vp-head .panel-tag");
  if (tag) {
    tag.textContent = "3D";
    tag.classList.remove("warn");
    tag.classList.add("accent");
  }
}

function resizeWildfirePov(entry) {
  if (!entry?.renderer?.setSize || !entry?.canvas?.parentElement) return;
  const frame = entry.canvas.parentElement;
  const w = Math.max(1, frame.clientWidth);
  const h = Math.max(1, frame.clientHeight);
  if (w === 0 || h === 0) return;
  entry.renderer.setSize(w, h, false);
  entry.camera.aspect = w / h;
  entry.camera.updateProjectionMatrix();
}

function disposeSceneResources(scene) {
  const seenGeo = new Set();
  scene?.traverse((obj) => {
    if (!obj.isInstancedMesh && !obj.isMesh && !obj.isPoints) return;

    const g = obj.geometry;
    if (g && !seenGeo.has(g)) {
      g.dispose();
      seenGeo.add(g);
    }
    const mats = obj.material;
    const list = Array.isArray(mats) ? mats : [mats];
    for (const mat of list) {
      if (!mat) continue;
      if (typeof mat.map?.dispose === "function") mat.map.dispose();
      mat.dispose?.();
    }
  });
}

function bootstrapWildfireAgents(scenario, meadowFn, pitchScale) {
  wfAgentMeshes.clear();

  for (const ag of scenario.agents || []) {
    const grp = createAgentMesh(ag.type);
    const p = meadowFn(ag.location[0], ag.location[1]);
    grp.position.x = p.x;
    grp.position.z = p.z;
    grp.position.y = pitchScale * 0.06;

    wfScene.add(grp);
    wfAgentMeshes.set(ag.id, grp);
  }
}

/** @type {THREE.WebGLRenderer | null} */
let wfFirstLeadRenderer = null;

function bootstrapWildfirePovs(scenario, povCols, horizonHex) {
  const s3 = PRESET_VISUAL.wildfire?.scene3d || PRESET_VISUAL.urban_quake.scene3d;
  const exposure = typeof s3.toneExposure === "number" ? s3.toneExposure : 1.14;

  for (let i = 0; i < povCols.length; i += 1) {
    const col = povCols[i];
    const canvas = col.querySelector("[data-pov-canvas]");
    if (!canvas?.parentElement) continue;

    const povFrame = canvas.parentElement;
    /** @type {THREE.WebGLRenderer} */
    let renderer;
    if (i === 0 && wfFirstLeadRenderer) {
      renderer = wfFirstLeadRenderer;
    } else {
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
      } catch (err) {
        console.warn(`Wildfire POV ${i}: WebGL unavailable`, err);
        canvas.replaceWith(
          Object.assign(document.createElement("div"), {
            style:
              "padding: 16px; color: #ffd95d; font-size: 10px; text-align: center;",
            textContent: "WebGL unavailable",
          }),
        );
        continue;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));
    }

    renderer.setClearColor(horizonHex, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;

    const w = Math.max(1, povFrame.clientWidth);
    const h = Math.max(1, povFrame.clientHeight);
    renderer.setSize(w, h, false);

    const camera = new THREE.PerspectiveCamera(72, w / h, 0.08, 80000);

    const povSpot = new THREE.SpotLight(0xffe8cc, 1.95, wfPitchScale * 48, Math.PI / 4, 0.38, 1.06);
    povSpot.position.set(0, 0, 0);
    povSpot.target.position.set(0, 0, -wfPitchScale * 14);
    camera.add(povSpot);
    camera.add(povSpot.target);
    wfScene.add(camera);

    const initialId = ui3d.DEFAULT_POV_AGENTS[i] || scenario.agents[i]?.id || scenario.agents[0]?.id;
    const heading = col.querySelector("[data-pov-heading]");
    if (heading) heading.textContent = `FPV · ${initialId}`;

    let smoothPos = new THREE.Vector3(0, wfPitchScale * 2.4, wfPitchScale * 4);
    let smoothLook = new THREE.Vector3(0, wfPitchScale * 0.6, wfPitchScale * -2);
    const agInit = scenario.agents.find((a) => a.id === initialId) || scenario.agents[0];
    if (agInit) {
      const p = wfMeadowGridToXZ(agInit.location[0], agInit.location[1]);
      const aerial = agInit.type === "drone" || agInit.type === "balloon";
      smoothPos.set(
        p.x,
        aerial ? wfPitchScale * tacticalFpvAltitudeUrbanUnits(agInit, 0.01) + 0.06 : wfPitchScale * 0.16,
        p.z,
      );
      smoothLook.copy(smoothPos).add(new THREE.Vector3(wfPitchScale * 3.2, 0, wfPitchScale * -2));
    }

    const entry = {
      col,
      canvas,
      renderer,
      camera,
      povSpot,
      wildfirePov: true,
      selectedId: initialId,
      smoothPos,
      smoothLook,
      smoothHdg: 0,
      smoothVel: 0,
      hud: {
        alt: col.querySelector("[data-hud='alt']"),
        hdg: col.querySelector("[data-hud='hdg']"),
        vel: col.querySelector("[data-hud='vel']"),
        pwr: col.querySelector("[data-hud='pwr']"),
        target: col.querySelector("[data-hud='target']"),
        heading,
      },
    };

    const ro = new ResizeObserver(() => resizeWildfirePov(entry));
    ro.observe(povFrame);
    entry.resizeObserver = ro;

    povs.push(entry);
    resizeWildfirePov(entry);
  }

  wfFirstLeadRenderer = null;

  buildAgentSelector(scenario.agents);
}

export function init3D(scenario, presetKey, povCols) {
  if (!povCols?.length) return;

  wfBootGeneration += 1;
  const bootId = wfBootGeneration;

  decorateWildfirePovChrome();
  setCurrentScenePreset(presetKey || "wildfire");

  wfCols = Math.max(2, scenario?.map?.size?.[0] || 30);
  wfRows = Math.max(2, scenario?.map?.size?.[1] || 30);
  wfMeadowGridToXZ = makeMeadowGridToWorldXZ(wfCols, wfRows);
  wfPitchScale = meadowAverageMetresPerCell(wfCols, wfRows);

  wfEzTrees = [];
  wfForestRoot = null;

  const horizon = SKY_BOTTOM.clone().multiplyScalar(0.92).getHex();

  const col0 = povCols[0];
  const canvas0 = col0?.querySelector("[data-pov-canvas]");
  const povFrame0 = canvas0?.parentElement;
  if (!canvas0 || !povFrame0) return;

  let leadRenderer = null;
  try {
    leadRenderer = new THREE.WebGLRenderer({
      canvas: canvas0,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    leadRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));
    const w0 = Math.max(1, povFrame0.clientWidth);
    const h0 = Math.max(1, povFrame0.clientHeight);
    leadRenderer.setSize(w0, h0, false);
  } catch (err) {
    console.warn("Wildfire meadow: WebGL unavailable", err);
    emitToast("default", "WebGL unavailable — FPV disabled.");
    return;
  }

  wfFirstLeadRenderer = leadRenderer;

  wfScene = new THREE.Scene();
  wfScene.background = new THREE.Color(horizon);
  wfScene.fog = new THREE.Fog(FOG_COLOR_HEX, MEADOW_FOG_NEAR, MEADOW_FOG_FAR);

  wfScene.add(createSkyDomeMesh());

  const Ls = WILDFIRE_LIGHT_LEGACY_SCALE;
  wfScene.add(new THREE.HemisphereLight(0xd6eeff, 0x5c4a36, 1.08));
  const sun = new THREE.DirectionalLight(0xfff8ea, 1.42);
  sun.position.set(52 * Ls, 76 * Ls, 38 * Ls);
  wfScene.add(sun);
  const fillSun = new THREE.DirectionalLight(0xd4e8ff, 0.42);
  fillSun.position.set(-44 * Ls, 38 * Ls, -42 * Ls);
  wfScene.add(fillSun);
  wfScene.add(new THREE.AmbientLight(0xd8eaf5, 0.38));

  if (bootId !== wfBootGeneration) return;

  try {
    const texAnisoCeil = Math.min(8, leadRenderer.capabilities.getMaxAnisotropy());
    const { root: forestRoot, trees } = createWildfireMeadowRoot({
      maxMapAniso: texAnisoCeil,
      shouldAbort: () => bootId !== wfBootGeneration,
    });
    wfEzTrees = trees;
    wfForestRoot = forestRoot;
    wfScene.add(forestRoot);
  } catch (err) {
    console.error("[wildfire ez-tree]", err);
    wfEzTrees = [];
    wfForestRoot = null;
    emitToast("default", "EZ-Tree forest failed — check console.");
  }

  bootstrapWildfireAgents(scenario, wfMeadowGridToXZ, wfPitchScale);
  bootstrapWildfirePovs(scenario, povCols, horizon);
}

function updateWildfireAgentMeshes(sim, frac, meadowFn, pitchScale, t) {
  const state = sim.state;
  if (!state?.agents) return;

  for (const ag of state.agents) {
    const mesh = wfAgentMeshes.get(ag.id);
    if (!mesh) continue;
    const prev = ag.prevLocation || ag.location;
    const ix = lerp(prev[0], ag.location[0], frac);
    const iy = lerp(prev[1], ag.location[1], frac);

    const p = meadowFn(ix, iy);

    let targetY;
    if (ag.type === "drone") {
      targetY = pitchScale * tacticalFpvAltitudeUrbanUnits(ag, t);
    } else if (ag.type === "balloon") {
      targetY =
        pitchScale *
        (3.6 +
          Math.sin(t * 0.35 + ag.id.charCodeAt(0)) * 0.18 +
          Math.sin(t * 0.18 + ag.id.charCodeAt(0) * 0.5) * 0.12);
    } else {
      targetY = pitchScale * (0.04 + Math.sin(t * 2 + ag.id.charCodeAt(0)) * 0.025);
    }
    mesh.position.set(p.x, targetY, p.z);

    const dx = ag.location[0] - prev[0];
    const dy = ag.location[1] - prev[1];
    if (Math.abs(dx) + Math.abs(dy) > 0.001) {
      const yaw = Math.atan2(dx, dy);
      mesh.rotation.y = lerp(mesh.rotation.y, yaw, 0.15);
    }

    if (mesh.userData.rotors) {
      for (let ri = 0; ri < mesh.userData.rotors.length; ri += 1) {
        mesh.userData.rotors[ri].rotation.y = t * 30 + ri * 0.5;
      }
    }
    if (mesh.userData.navLight) {
      const blink = 0.5 + 0.5 * Math.sin(t * 6 + ag.id.charCodeAt(0));
      mesh.userData.navLight.intensity =
        ag.type === "drone" ? 1.4 + blink * 0.6 : 0.9 + blink * 0.3;
    }
    if (mesh.userData.beacon) {
      const pulse = (Math.sin(t * 4.5 + ag.id.charCodeAt(0)) + 1) * 0.5;
      const bm = mesh.userData.beacon.material;
      if (bm?.emissiveIntensity !== undefined) bm.emissiveIntensity = 0.6 + pulse * 4;
    }
    if (mesh.userData.statusRing) {
      const slow = (Math.sin(t * 1.2 + ag.id.charCodeAt(0)) + 1) * 0.5;
      const rm = mesh.userData.statusRing.material;
      if (rm?.emissiveIntensity !== undefined) rm.emissiveIntensity = 0.6 + slow * 1.4;
    }
  }
}

export function update3D(t, sim) {
  if (!wfScene || !sim?.state || povs.length === 0) return;

  grassWindTimeUniform.value = t;
  wfForestRoot?.userData?.tickWildfireBurn?.(t);
  for (let i = 0; i < wfEzTrees.length; i += 1) wfEzTrees[i]?.update?.(t);

  const { state, plan, lastTickAt, msPerTick } = sim;
  const frac = Math.min(1, Math.max(0, (performance.now() - lastTickAt) / msPerTick));

  const meadowFn = wfMeadowGridToXZ;

  updateWildfireAgentMeshes(sim, frac, meadowFn, wfPitchScale, t);

  const pitchScale = wfPitchScale;

  for (const entry of povs) {
    if (!entry.renderer || !entry.camera || entry.wildfirePov !== true) continue;

    const driver =
      state.agents.find((a) => a.id === entry.selectedId) || state.agents[0];
    if (!driver) continue;

    const prev = driver.prevLocation || driver.location;
    const ix = lerp(prev[0], driver.location[0], frac);
    const iy = lerp(prev[1], driver.location[1], frac);

    const phaseSeed = tacticalFpvPhaseSeed(driver);
    const isAerial = driver.type === "drone" || driver.type === "balloon";
    const headBobX = isAerial ? Math.sin(t * 1.6 + phaseSeed) * 0.05 : 0;
    const headBobY = isAerial ? Math.sin(t * 2.2 + phaseSeed) * 0.04 : 0;

    const targetPos = tacticalFpvEyeWorldPosition(ix, iy, driver, t, meadowFn, {
      groundY: 0,
      pitchScale,
      headBobX,
      headBobY,
    });

    const target = currentTargetFor(driver, state, plan);
    const fwd = tacticalFpvForwardVector(driver, prev, ix, iy, t, target, meadowFn, pitchScale);
    const lookDist = tacticalFpvLookDistanceWorld(isAerial, pitchScale);
    const lookAt = targetPos.clone().addScaledVector(fwd, lookDist);

    entry.smoothPos.lerp(targetPos, 0.18);
    entry.smoothLook.lerp(lookAt, 0.12);
    entry.camera.position.copy(entry.smoothPos);
    entry.camera.lookAt(entry.smoothLook);

    const vel =
      Math.hypot(driver.location[0] - prev[0], driver.location[1] - prev[1]) /
      (msPerTick / 1000);
    entry.smoothVel = lerp(entry.smoothVel, vel, 0.15);
    const hdgRad = Math.atan2(driver.location[0] - prev[0], driver.location[1] - prev[1]);
    const hdgDeg = ((hdgRad * 180) / Math.PI + 360) % 360;
    entry.smoothHdg = lerpAngleDeg(entry.smoothHdg, hdgDeg, 0.12);

    const altM =
      tacticalFpvAltitudeUrbanUnits(driver, t) * pitchScale + headBobY * pitchScale;
    if (entry.hud.alt) entry.hud.alt.textContent = altM.toFixed(1);
    if (entry.hud.hdg) entry.hud.hdg.textContent = String(Math.round(entry.smoothHdg)).padStart(3, "0");
    if (entry.hud.vel) entry.hud.vel.textContent = entry.smoothVel.toFixed(1);
    if (entry.hud.pwr) entry.hud.pwr.textContent = `${Math.round(driver.battery)}%`;
    if (entry.hud.target) {
      const tid = currentTargetIdFor(driver, plan);
      entry.hud.target.textContent = tid ? `TGT ${tid}` : "TGT —";
    }

    for (const [id, m] of wfAgentMeshes) m.visible = id !== driver.id;
    entry.renderer.render(wfScene, entry.camera);
  }

  for (const m of wfAgentMeshes.values()) m.visible = true;
}

export function teardown3D() {
  wfBootGeneration += 1;

  teardownAgentSelector();
  if (ui3d.agentSelectorHost) ui3d.agentSelectorHost.innerHTML = "";
  ui3d.agentCardEls?.clear?.();

  povColumnEl()?.classList.remove("wildfire-splat-active");

  wfFirstLeadRenderer = null;

  for (const entry of [...povs]) {
    entry.resizeObserver?.disconnect();
    if (wfScene && entry.camera) wfScene.remove(entry.camera);
    try {
      entry.renderer?.dispose();
    } catch {
      /* ignore */
    }
    const parent = entry.canvas?.parentElement;
    if (parent && entry.canvas) {
      const fresh = entry.canvas.cloneNode(false);
      parent.replaceChild(fresh, entry.canvas);
    }
  }
  povs.length = 0;

  wfEzTrees = [];
  wfForestRoot = null;
  wfAgentMeshes.clear();

  if (wfScene) {
    wfScene.getObjectByName("wildfire_ez_forest")?.userData?.cancelWildfireEzTreeMount?.();
    disposeSceneResources(wfScene);
    wfScene.clear();
    wfScene = null;
  }
}

export function buildingAvoidanceRects(scenario) {
  return wildfireBurnAvoidanceRects(scenario);
}
