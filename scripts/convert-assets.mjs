/**
 * EAM165 OBJ -> lightweight web GLB pipeline.
 *
 * The source pack contains very large OBJ/MTL exports and no texture maps. For
 * the browser simulation we sample geometry into compact, normalized GLBs, then
 * apply quake-appropriate materials at runtime.
 *
 * Run: node scripts/convert-assets.mjs
 */
import { createReadStream } from "node:fs";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_OBJ = "C:/Users/Timothy Lin/Downloads/EAM165-灾难建筑车辆城市灾难废墟108件/OBJ/OBJ";
const OUT_DIR = join(ROOT, "public", "simulation", "data", "urban-quake", "assets", "models");

const PICKS = [
  { id: "001", slug: "vehicle-wreck-a", maxTriangles: 4200, sampleEvery: 18, color: [0.45, 0.38, 0.32, 1] },
  { id: "060", slug: "debris-pile-a", maxTriangles: 3600, sampleEvery: 16, color: [0.48, 0.40, 0.32, 1] },
  { id: "080", slug: "street-prop-a", maxTriangles: 2800, sampleEvery: 14, color: [0.36, 0.38, 0.35, 1] },
  { id: "090", slug: "building-intact-a", maxTriangles: 5200, sampleEvery: 22, color: [0.58, 0.63, 0.67, 1] },
  { id: "095", slug: "building-intact-b", maxTriangles: 5200, sampleEvery: 22, color: [0.56, 0.52, 0.45, 1] },
  { id: "100", slug: "collapsed-facade-a", maxTriangles: 5600, sampleEvery: 24, color: [0.43, 0.37, 0.31, 1] },
  { id: "105", slug: "collapsed-facade-b", maxTriangles: 5600, sampleEvery: 24, color: [0.40, 0.36, 0.32, 1] },
];

function fmtSize(p) {
  try {
    const b = statSync(p).size;
    if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
    if (b > 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  } catch {
    return "?";
  }
}

function findObjForId(id) {
  const cands = [
    `AM165_${id}_VRay.obj`,
    `AM165_${id}_Vray.obj`,
    `AM165_${id}_vray.obj`,
  ];
  for (const c of cands) {
    const p = join(SRC_OBJ, c);
    if (existsSync(p)) return p;
  }
  return null;
}

function parseFaceIndex(token, vertexCount) {
  const raw = Number.parseInt(token.split("/")[0], 10);
  if (!Number.isFinite(raw) || raw === 0) return null;
  return raw < 0 ? vertexCount + raw : raw - 1;
}

function pushTriangle(out, vertices, ia, ib, ic) {
  const a = vertices[ia];
  const b = vertices[ib];
  const c = vertices[ic];
  if (!a || !b || !c) return false;
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  return true;
}

async function sampleObj(objPath, pick) {
  const vertices = [];
  const positions = [];
  let faceCount = 0;
  let triCount = 0;

  const rl = createInterface({
    input: createReadStream(objPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.trim().split(/\s+/);
      vertices.push([Number(x), Number(y), Number(z)]);
      continue;
    }
    if (!line.startsWith("f ")) continue;

    faceCount += 1;
    if (faceCount % pick.sampleEvery !== 0 || triCount >= pick.maxTriangles) continue;

    const indices = line.trim().split(/\s+/).slice(1)
      .map((token) => parseFaceIndex(token, vertices.length))
      .filter((idx) => idx !== null);
    if (indices.length < 3) continue;
    for (let i = 1; i < indices.length - 1 && triCount < pick.maxTriangles; i += 1) {
      if (pushTriangle(positions, vertices, indices[0], indices[i], indices[i + 1])) triCount += 1;
    }
  }

  if (triCount === 0) throw new Error(`No triangles sampled from ${objPath}`);
  return { positions, sourceVertices: vertices.length, sourceFaces: faceCount, triangles: triCount };
}

function normalizePositions(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }

  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const scale = 1 / Math.max(size[0], size[1], size[2], 0.001);
  const center = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const out = new Float32Array(positions.length);
  const outMin = [Infinity, Infinity, Infinity];
  const outMax = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    out[i] = (positions[i] - center[0]) * scale;
    out[i + 1] = (positions[i + 1] - center[1]) * scale;
    out[i + 2] = (positions[i + 2] - center[2]) * scale;
    for (let a = 0; a < 3; a += 1) {
      outMin[a] = Math.min(outMin[a], out[i + a]);
      outMax[a] = Math.max(outMax[a], out[i + a]);
    }
  }
  return { positions: out, min: outMin, max: outMax };
}

function computeFlatNormals(positions) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let v = 0; v < 3; v += 1) {
      normals[i + v * 3] = nx;
      normals[i + v * 3 + 1] = ny;
      normals[i + v * 3 + 2] = nz;
    }
  }
  return normals;
}

function align4(n) {
  return (n + 3) & ~3;
}

function floatBuffer(values) {
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i += 1) buf.writeFloatLE(values[i], i * 4);
  return buf;
}

function padBuffer(buf, padByte = 0) {
  const next = align4(buf.length);
  if (next === buf.length) return buf;
  return Buffer.concat([buf, Buffer.alloc(next - buf.length, padByte)]);
}

function makeGlb({ positions, normals, min, max, color, name }) {
  const posBuf = padBuffer(floatBuffer(positions));
  const normalOffset = posBuf.length;
  const normBuf = padBuffer(floatBuffer(normals));
  const bin = padBuffer(Buffer.concat([posBuf, normBuf]));
  const vertexCount = positions.length / 3;

  const json = {
    asset: { version: "2.0", generator: "ARC EAM165 sampler" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        material: 0,
        mode: 4,
      }],
    }],
    materials: [{
      name: `${name}-mat`,
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: 0.04,
        roughnessFactor: 0.92,
      },
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normBuf.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: "VEC3" },
    ],
  };

  const jsonBuf = padBuffer(Buffer.from(JSON.stringify(json)), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]);
}

async function processPick(pick) {
  const objSrc = findObjForId(pick.id);
  if (!objSrc) {
    console.warn(`!! No OBJ for ${pick.id}, skipping`);
    return false;
  }

  const sampled = await sampleObj(objSrc, pick);
  const normalized = normalizePositions(sampled.positions);
  const normals = computeFlatNormals(normalized.positions);
  const glb = makeGlb({
    positions: normalized.positions,
    normals,
    min: normalized.min,
    max: normalized.max,
    color: pick.color,
    name: pick.slug,
  });

  const outPath = join(OUT_DIR, `${pick.slug}.glb`);
  writeFileSync(outPath, glb);
  console.log(
    `  source v=${sampled.sourceVertices.toLocaleString()} f=${sampled.sourceFaces.toLocaleString()} ` +
    `sampled tris=${sampled.triangles.toLocaleString()} -> ${fmtSize(outPath)}`,
  );
  return true;
}

async function main() {
  if (!existsSync(SRC_OBJ)) {
    throw new Error(`Missing EAM165 OBJ folder: ${SRC_OBJ}`);
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const visible = readdirSync(SRC_OBJ).filter((name) => /\.obj$/i.test(name)).length;
  console.log(`Found ${visible} EAM165 OBJ files`);
  console.log(`Converting ${PICKS.length} selected assets to ${OUT_DIR}\n`);

  const results = [];
  for (const p of PICKS) {
    console.log(`\n=== ${p.id} -> ${p.slug} ===`);
    try {
      const ok = await processPick(p);
      results.push({ slug: p.slug, ok });
    } catch (e) {
      console.error(`!! ${p.slug} failed:`, e.message);
      results.push({ slug: p.slug, ok: false });
    }
  }

  console.log("\n=== Summary ===");
  for (const r of results) console.log(`${r.ok ? "ok" : "missing"} ${r.slug}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
