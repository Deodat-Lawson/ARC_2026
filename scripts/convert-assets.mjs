/**
 * EAM165 → web pipeline.
 *
 * For each picked asset:
 *   1. Copy OBJ to a per-asset staging dir
 *   2. obj2gltf → raw GLB (no textures — we apply procedural materials at
 *      runtime in R3F because the building OBJs have multi-material slots
 *      with no MTL texture references, only V-Ray procedurals)
 *   3. gltf-transform: weld → simplify (decimate) → draco compress
 *   4. Final GLB → public/models/
 *
 * Run:  node scripts/convert-assets.mjs
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_OBJ = "C:/Users/Timothy Lin/Downloads/EAM165-灾难建筑车辆城市灾难废墟108件/OBJ/OBJ";
const OUT_DIR = join(ROOT, "public", "models");
const TMP_DIR = join(__dirname, "_tmp");

const PICKS = [
  { id: "001", slug: "vehicle-taxi", ratio: 0.35 },
  { id: "060", slug: "rubble-large", ratio: 0.4 },
  { id: "080", slug: "street-signs", ratio: 0.5 },
  { id: "090", slug: "building-apartment", ratio: 0.3 },
  { id: "095", slug: "building-facade", ratio: 0.3 },
  { id: "100", slug: "building-multistory", ratio: 0.3 },
  { id: "105", slug: "building-mansion", ratio: 0.3 },
];

/**
 * Quote a path for cmd.exe — use double quotes; the existing quote chars in
 * the path don't need escaping for our use case (no embedded quotes in the
 * project paths).
 */
function q(p) {
  return `"${p}"`;
}

function sh(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", shell: true });
}

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

/** Strip the mtllib line from the OBJ so obj2gltf doesn't choke on the broken MTL ref. */
function stripMtlLib(objPath) {
  const text = readFileSync(objPath, "utf8");
  const stripped = text.replace(/^mtllib .*$/m, "# mtllib stripped");
  writeFileSync(objPath, stripped);
}

const GLTF_TRANSFORM =
  process.platform === "win32"
    ? join(ROOT, "node_modules", ".bin", "gltf-transform.cmd")
    : join(ROOT, "node_modules", ".bin", "gltf-transform");

function processPick(p) {
  const objSrc = findObjForId(p.id);
  if (!objSrc) {
    console.warn(`!! No OBJ for ${p.id}, skipping`);
    return false;
  }

  const stageDir = join(TMP_DIR, p.slug);
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  const objLocal = join(stageDir, `${p.slug}.obj`);
  copyFileSync(objSrc, objLocal);
  stripMtlLib(objLocal);

  // OBJ → GLB
  const rawGlb = join(stageDir, `${p.slug}.raw.glb`);
  sh(`npx -y obj2gltf -i ${q(objLocal)} -o ${q(rawGlb)} --secure`);
  console.log(`  raw GLB: ${fmtSize(rawGlb)}`);

  const optGlb = join(OUT_DIR, `${p.slug}.glb`);

  // Weld duplicate vertices
  sh(`${q(GLTF_TRANSFORM)} weld ${q(rawGlb)} ${q(rawGlb)}`);
  // Decimate (mesh simplification)
  sh(
    `${q(GLTF_TRANSFORM)} simplify ${q(rawGlb)} ${q(rawGlb)} --ratio ${p.ratio} --error 0.01`,
  );
  // Draco compression for geometry
  sh(`${q(GLTF_TRANSFORM)} draco ${q(rawGlb)} ${q(optGlb)}`);

  console.log(`  ✓ ${p.slug}.glb : ${fmtSize(optGlb)}`);
  return true;
}

(() => {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

  console.log(`Converting ${PICKS.length} assets to public/models/\n`);
  const results = [];
  for (const p of PICKS) {
    console.log(`\n=== ${p.id} → ${p.slug} ===`);
    try {
      const ok = processPick(p);
      results.push({ slug: p.slug, ok });
    } catch (e) {
      console.error(`!! ${p.slug} failed:`, e.message);
      results.push({ slug: p.slug, ok: false });
    }
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.slug}`);
  }
})();
