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
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC =
  "C:/Users/Timothy Lin/Downloads/KBS105-倒塌废墟战后街道楼房建筑/Textures/Textures";
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

async function resize(src, dst, opts) {
  await sharp(src)
    .resize(1024, 1024, { fit: "fill" })
    .jpeg({ quality: opts.quality ?? 80, progressive: true, mozjpeg: true })
    .toFile(dst);
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
