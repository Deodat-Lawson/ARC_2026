/**
 * Stage AM165_001 FBX + resized color texture into public/models-fbx/ so
 * Three.js's runtime FBXLoader can fetch them.
 *
 * Resizes the 17 MB color texture to a web-friendly 1024×1024 JPEG q75.
 * Texture filename is preserved so the FBX's embedded reference resolves.
 */
import { existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_FBX_DIR =
  "C:/Users/Timothy Lin/Downloads/EAM165-灾难建筑车辆城市灾难废墟108件/FBX/FBX";
const SRC_TEX_DIR =
  "C:/Users/Timothy Lin/Downloads/EAM165-灾难建筑车辆城市灾难废墟108件/Textures/Textures";
const OUT = join(ROOT, "public", "models-fbx");

function fmtSize(p) {
  const b = statSync(p).size;
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

async function resizeTexture(src, dst, size = 1024, quality = 75) {
  await sharp(src)
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, progressive: true, mozjpeg: true })
    .toFile(dst);
}

const ASSETS = [
  {
    id: "001",
    name: "vehicle-taxi",
    textures: ["color", "bump_nm"],
  },
];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

for (const a of ASSETS) {
  console.log(`\n=== ${a.id} ${a.name} ===`);

  // Copy FBX as-is
  const fbxSrc = join(SRC_FBX_DIR, `AM165_${a.id}_VRay.fbx`);
  const fbxDst = join(OUT, `AM165_${a.id}_VRay.fbx`);
  copyFileSync(fbxSrc, fbxDst);
  console.log(`  FBX: ${fmtSize(fbxDst)}`);

  // Resize textures (extensions vary by asset)
  for (const kind of a.textures) {
    const tryExts = ["jpg", "JPG", "jpeg"];
    let foundSrc = null;
    let chosenName = null;
    for (const ext of tryExts) {
      const candidate = join(SRC_TEX_DIR, `AM165_${a.id}_${kind}.${ext}`);
      if (existsSync(candidate)) {
        foundSrc = candidate;
        chosenName = `AM165_${a.id}_${kind}.${ext}`;
        break;
      }
    }
    if (!foundSrc) {
      console.warn(`  !! No texture for ${kind}, skipping`);
      continue;
    }
    const dst = join(OUT, chosenName);
    await resizeTexture(foundSrc, dst, 1024, 75);
    console.log(`  ${kind}: ${fmtSize(foundSrc)} → ${fmtSize(dst)} (${chosenName})`);
  }
}

console.log("\nDone.");
