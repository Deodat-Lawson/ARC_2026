/**
 * Stage KBS105 PBR texture sets into public/textures/ for triplanar use.
 *
 * Resizes 3 PBR sets (basecolor + normal + roughness, plus metallic where
 * available) from ~10 MB JPEGs down to 1024×1024 JPEG q80 — ~150–300 KB each.
 *
 * Triplanar projection means these tile across ANY geometry regardless of
 * the source mesh's UVs, so they work on the EAM165 buildings (whose source
 * UVs were never connected to web-friendly textures).
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_PACK =
  "C:/Users/Timothy Lin/Downloads/KBS105-倒塌废墟战后街道楼房建筑";
const PACK_ROOT = process.env.KBS105_SRC || DEFAULT_PACK;
const SRC = process.env.KBS105_TEXTURES || findTexturesDir(PACK_ROOT);
const OUT = join(ROOT, "public", "textures");

const SETS = [
  {
    slug: "concrete-a",
    base: "KB3D_WZT_ConcreteA",
    maps: ["basecolor", "normal", "roughness"],
  },
  {
    slug: "bricks-damage",
    base: "KB3D_WZT_bricksAdamage",
    maps: ["basecolor", "normal", "roughness"],
  },
  {
    slug: "metal-rust",
    base: "KB3D_WZT_MetalRustA",
    maps: ["basecolor", "normal", "roughness", "metallic"],
  },
];

function fmtSize(p) {
  const b = statSync(p).size;
  return b > 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(2)} MB`
    : `${(b / 1024).toFixed(1)} KB`;
}

function findTexturesDir(root) {
  const preferred = join(root, "Textures", "Textures");
  if (existsSync(preferred)) return preferred;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase().includes("texture")) return full;
        stack.push(full);
      }
    }
  }
  return preferred;
}

async function resize(src, dst, opts) {
  await sharp(src)
    .resize(1024, 1024, { fit: "fill" })
    .jpeg({ quality: opts.quality ?? 80, progressive: true, mozjpeg: true })
    .toFile(dst);
}

if (!existsSync(SRC)) {
  console.warn(`KBS105 texture folder not found: ${SRC}`);
  console.warn("Run `pnpm assets:inventory` and recover the real KBS105 payload before preparing PBR maps.");
  process.exitCode = 1;
  process.exit();
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

for (const set of SETS) {
  console.log(`\n=== ${set.slug} ===`);
  for (const m of set.maps) {
    // Some files are .JPG (uppercase), some .jpg. Try both.
    const candidates = [
      `${set.base}_${m}.jpg`,
      `${set.base}_${m}.JPG`,
    ];
    let src = null;
    for (const c of candidates) {
      const p = join(SRC, c);
      if (existsSync(p)) {
        src = p;
        break;
      }
    }
    if (!src) {
      console.warn(`  !! Missing ${m} for ${set.base}`);
      continue;
    }
    // Roughness/metallic don't need high JPEG quality — they're data maps
    const isData = m === "roughness" || m === "metallic";
    const dst = join(OUT, `${set.slug}_${m}.jpg`);
    await resize(src, dst, { quality: isData ? 70 : 82 });
    console.log(`  ${m}: ${fmtSize(src)} → ${fmtSize(dst)}`);
  }
}

console.log("\nDone.");
