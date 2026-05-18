/**
 * Shared meadow + EZ-Tree scene graph (dirt, grass tufts, flowers, trees, sky helpers).
 * Used by wildfire.js and wildfire-meadow-preview.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Tree, TreePreset } from "@dgreenheck/ez-tree";

/** Mutated each frame by consumers for grass wind shader injection. */
export const grassWindTimeUniform = { value: 0 };

export const SKY_TOP = new THREE.Color(0x4a9fe8);
export const SKY_BOTTOM = new THREE.Color(0xb8dcf5);
export const FOG_COLOR_HEX = 0xc5e2f5;

export const FOREST_HALF_EXTENT = 52;
export const TREE_COUNT = 96;
export const PLACEMENT_HALF_SCALE = 0.62;
export const GRASS_TUFT_COUNT = 4600;
export const FLOWER_COUNT = 560;

export const FOREST_PRESETS = ["Oak Small", "Aspen Small", "Ash Small", "Pine Small"];

function applyForestLodCaps(o) {
  const ch = o.branch.children;
  for (const k of Object.keys(ch)) {
    const n = Number(k);
    const maxN = n === 0 ? 16 : n === 1 ? 8 : 6;
    ch[k] = Math.min(ch[k], maxN);
  }
  o.leaves.count = Math.min(o.leaves.count ?? 20, 22);
  for (let lvl = 0; lvl <= 3; lvl++) {
    const key = String(lvl);
    if (o.branch.segments[key] != null) o.branch.segments[key] = Math.min(o.branch.segments[key], 6);
    if (o.branch.sections[key] != null) o.branch.sections[key] = Math.min(o.branch.sections[key], 12);
  }
}

function optionsFromPreset(presetName) {
  const src = TreePreset[presetName];
  if (!src) return structuredClone(TreePreset["Oak Small"]);
  const o = structuredClone(src);
  applyForestLodCaps(o);
  return o;
}

function createDirtGroundTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  if (!ctx) {
    tex.needsUpdate = true;
    return tex;
  }

  ctx.fillStyle = "#5c4330";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const d = 28 + Math.random() * 65;
    const g = ctx.createRadialGradient(x, y, 0, x, y, d);
    const a = 0.04 + Math.random() * 0.09;
    g.addColorStop(
      0,
      `rgba(${35 + Math.random() * 40},${22 + Math.random() * 28},${14 + Math.random() * 18},${a})`,
    );
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(${55 + Math.random() * 35},${38 + Math.random() * 25},${18 + Math.random() * 18},${0.03 + Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }

  tex.needsUpdate = true;
  return tex;
}

function createGrassTuftTexture() {
  const w = 56;
  const h = 148;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  if (!ctx) {
    tex.needsUpdate = true;
    return tex;
  }

  ctx.clearRect(0, 0, w, h);

  const strokes = 14 + Math.floor(Math.random() * 5);
  for (let s = 0; s < strokes; s++) {
    const cx = w * 0.5 + (Math.random() - 0.5) * w * 0.35;
    const bw = 2 + Math.random() * 5;
    const tilt = (Math.random() - 0.5) * 0.28;
    const g = ctx.createLinearGradient(cx - bw, h, cx + bw, 0);
    const hue = 78 + Math.random() * 44;
    const lightBot = 22 + Math.random() * 12;
    const lightTop = 42 + Math.random() * 22;
    g.addColorStop(0, `hsla(${hue}, 55%, ${lightBot}%, 0.92)`);
    g.addColorStop(0.55, `hsla(${hue + 8}, 48%, ${lightTop * 0.85}%, 0.75)`);
    g.addColorStop(1, `hsla(${hue + 15}, 42%, ${lightTop}%, 0.08)`);
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, h * 0.97);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(-bw * 0.5, 0);
    ctx.quadraticCurveTo(-bw * 0.3, -h * 0.55, 0, -h * (0.88 + Math.random() * 0.08));
    ctx.quadraticCurveTo(bw * 0.35, -h * 0.45, bw * 0.55, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let y = 0; y < h; y++) {
    const ny = y / (h - 1);
    const edgeFade = Math.pow(Math.min(ny / 0.14, 1), 1.8);
    const horiz = Math.sin((ny * Math.PI * 0.95) ** 1.1);
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1);
      const cx = Math.abs(nx - 0.5) * 2;
      const lateral = 1 - Math.pow(cx, 2.2) * 0.92;
      const i = (y * w + x) * 4;
      let a = d[i + 3] / 255;
      a *= lateral * edgeFade * (0.72 + horiz * 0.28);
      d[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  tex.needsUpdate = true;
  return tex;
}

function createGrassTuftCrossGeometry() {
  const gw = 0.52;
  const gh = 0.82;
  const g0 = new THREE.PlaneGeometry(gw, gh);
  g0.translate(0, gh * 0.5, 0);
  const g1 = new THREE.PlaneGeometry(gw, gh);
  g1.rotateY(Math.PI / 2);
  g1.translate(0, gh * 0.5, 0);
  const merged = mergeGeometries([g0, g1]);
  return merged ?? g0;
}

function createFlowerSpriteTexture() {
  const s = 48;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) {
    tex.needsUpdate = true;
    return tex;
  }
  const g = ctx.createRadialGradient(s * 0.5, s * 0.52, 2, s * 0.5, s * 0.5, s * 0.42);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.needsUpdate = true;
  return tex;
}

export function createSkyDomeMesh() {
  const geo = new THREE.SphereGeometry(380, 28, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: SKY_TOP.clone() },
      bottomColor: { value: SKY_BOTTOM.clone() },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying float vH;
      void main() {
        float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottomColor, topColor, pow(t, 0.78));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "wildfire_sky";
  mesh.frustumCulled = false;
  return mesh;
}

function isNearBlocked(x, z, blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r) return true;
  }
  return false;
}

function sampleFieldXZ(half, rnd, blocks) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const radial = rnd() < 0.62 ? 0.22 + rnd() * 0.72 : 0.48 + rnd() * 0.52;
    const ang = rnd() * Math.PI * 2;
    const x = Math.cos(ang) * half * radial;
    const z = Math.sin(ang) * half * radial;
    if (!isNearBlocked(x, z, blocks)) return { x, z };
  }
  const ang = rnd() * Math.PI * 2;
  const radial = rnd() * 0.45;
  return { x: Math.cos(ang) * half * radial, z: Math.sin(ang) * half * radial };
}

/**
 * @returns {{ root: THREE.Group; trees: Tree[] }}
 */
export function createWildfireMeadowRoot() {
  const root = new THREE.Group();
  root.name = "wildfire_ez_forest";

  const planeSize = FOREST_HALF_EXTENT * 2 + 24;
  const groundGeo = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);

  const dirtMap = createDirtGroundTexture();
  const dirtRepeats = Math.max(18, planeSize * 0.22);
  dirtMap.repeat.set(dirtRepeats, dirtRepeats);

  const groundMat = new THREE.MeshStandardMaterial({
    map: dirtMap,
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = false;
  root.add(ground);

  const half = (FOREST_HALF_EXTENT - 1) * PLACEMENT_HALF_SCALE;
  const rnd = () => Math.random();

  const treeBlocks = [];
  /** @type {{ presetName: string; seed: number; x: number; z: number; scale: number; rotY: number }[]} */
  const treePlacements = [];

  for (let i = 0; i < TREE_COUNT; i++) {
    const presetName = FOREST_PRESETS[i % FOREST_PRESETS.length];
    const radial = rnd() < 0.65 ? 0.28 + rnd() * 0.62 : 0.52 + rnd() * 0.48;
    const ang = rnd() * Math.PI * 2;
    const x = Math.cos(ang) * half * radial;
    const z = Math.sin(ang) * half * radial;
    const scale = presetName.includes("Pine") ? 0.048 + rnd() * 0.028 : 0.055 + rnd() * 0.038;
    const seed = ((TreePreset[presetName]?.seed ?? 30895) + i * 104729 + Math.floor(rnd() * 10000)) >>> 0;
    treePlacements.push({
      presetName,
      seed,
      x,
      z,
      scale,
      rotY: rnd() * Math.PI * 2,
    });
    treeBlocks.push({ x, z, r: Math.max(1.15, scale * 26) });
  }

  const grassTex = createGrassTuftTexture();
  const grassGeo = createGrassTuftCrossGeometry();
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    transparent: true,
    alphaTest: 0.2,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0,
    depthWrite: true,
  });

  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassWindTimeUniform;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      float gust = sin(transformed.x * 2.8 + uTime * 1.9) * cos(transformed.z * 2.3 + uTime * 1.4);
      float h = max(0.0, uv.y);
      transformed.xz += gust * 0.045 * h * h;
      transformed.x += cos(uTime * 1.1 + transformed.z * 1.7) * 0.022 * h * h;
      `,
    );
  };

  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_TUFT_COUNT);
  grassMesh.frustumCulled = true;

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0);

  for (let i = 0; i < GRASS_TUFT_COUNT; i++) {
    const { x, z } = sampleFieldXZ(half * 1.05, rnd, treeBlocks);
    const sy = 0.72 + rnd() * 1.35;
    const sxz = 0.82 + rnd() * 0.55;
    euler.set((rnd() - 0.5) * 0.16, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12);
    q.setFromEuler(euler);
    s.set(sxz, sy, sxz);
    p.set(x, 0, z);
    m.compose(p, q, s);
    grassMesh.setMatrixAt(i, m);
  }
  grassMesh.instanceMatrix.needsUpdate = true;

  root.add(grassMesh);

  const flowerTex = createFlowerSpriteTexture();
  const flowerGeo = new THREE.PlaneGeometry(0.2, 0.2);
  flowerGeo.translate(0, 0.1, 0);
  const flowerMat = new THREE.MeshBasicMaterial({
    map: flowerTex,
    transparent: true,
    alphaTest: 0.15,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,
    depthWrite: false,
    vertexColors: true,
  });

  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWER_COUNT);
  flowerMesh.frustumCulled = true;
  const flowerColors = [
    new THREE.Color(0xd896ff),
    new THREE.Color(0xfff176),
    new THREE.Color(0xffffff),
    new THREE.Color(0xc77dff),
    new THREE.Color(0xffe082),
  ];

  for (let i = 0; i < FLOWER_COUNT; i++) {
    const { x, z } = sampleFieldXZ(half * 1.02, rnd, treeBlocks);
    euler.set(0, rnd() * Math.PI * 2, 0);
    q.setFromEuler(euler);
    const fs = 0.65 + rnd() * 1.2;
    s.set(fs, fs, fs);
    p.set(x, 0.03 + rnd() * 0.06, z);
    m.compose(p, q, s);
    flowerMesh.setMatrixAt(i, m);
    flowerMesh.setColorAt(i, flowerColors[(i + Math.floor(rnd() * 50)) % flowerColors.length]);
  }
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;

  root.add(flowerMesh);

  /** @type {Tree[]} */
  const trees = [];

  for (let i = 0; i < treePlacements.length; i++) {
    const pl = treePlacements[i];
    const opts = optionsFromPreset(pl.presetName);
    opts.seed = pl.seed;

    const tree = new Tree();
    tree.loadFromJson(opts);

    tree.position.set(pl.x, 0, pl.z);
    tree.rotation.y = pl.rotY;
    tree.scale.setScalar(pl.scale);

    root.add(tree);
    trees.push(tree);
  }

  return { root, trees };
}
