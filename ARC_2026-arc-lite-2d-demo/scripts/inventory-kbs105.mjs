/**
 * Inventory the KBS105 disaster-street asset pack before attempting conversion.
 *
 * The download sometimes arrives as nested placeholder folders containing only
 * shop/disclaimer files. This script makes that state explicit and lists which
 * runtime-ready source assets are actually available.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const DEFAULT_SRC =
  "C:/Users/Timothy Lin/Downloads/KBS105-倒塌废墟战后街道楼房建筑";
const SRC = process.env.KBS105_SRC || DEFAULT_SRC;

const MODEL_EXTS = new Set([".fbx", ".obj", ".glb", ".gltf", ".c4d", ".mb"]);
const TEXTURE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tga",
  ".tif",
  ".tiff",
  ".exr",
  ".hdr",
  ".webp",
]);
const LICENSE_HINTS = ["声明", "readme", "license", "licence", "版权"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function summarize(files) {
  const byExt = new Map();
  for (const file of files) {
    const ext = extname(file).toLowerCase() || "(none)";
    byExt.set(ext, (byExt.get(ext) || 0) + 1);
  }
  return [...byExt.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

const files = walk(SRC);
const models = files.filter((file) => MODEL_EXTS.has(extname(file).toLowerCase()));
const textures = files.filter((file) =>
  TEXTURE_EXTS.has(extname(file).toLowerCase()),
);
const notes = files.filter((file) => {
  const lower = file.toLowerCase();
  return LICENSE_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
});

console.log(`KBS105 source: ${SRC}`);

if (!existsSync(SRC)) {
  console.log("Status: missing source folder.");
  process.exitCode = 2;
} else {
  console.log(`Files: ${files.length}`);
  console.log(`Models: ${models.length}`);
  console.log(`Textures: ${textures.length}`);
  console.log("\nExtensions:");
  for (const [ext, count] of summarize(files)) {
    console.log(`  ${ext}: ${count}`);
  }

  if (models.length) {
    console.log("\nModel candidates:");
    for (const file of models.slice(0, 30)) {
      console.log(`  ${relative(SRC, file)} (${fmtSize(statSync(file).size)})`);
    }
    if (models.length > 30) console.log(`  ... ${models.length - 30} more`);
  }

  if (textures.length) {
    console.log("\nTexture candidates:");
    for (const file of textures.slice(0, 30)) {
      console.log(`  ${relative(SRC, file)} (${fmtSize(statSync(file).size)})`);
    }
    if (textures.length > 30) console.log(`  ... ${textures.length - 30} more`);
  }

  if (notes.length) {
    console.log("\nLicense / disclaimer notes:");
    for (const file of notes.slice(0, 5)) {
      console.log(`\n--- ${relative(SRC, file)} ---`);
      const text = readFileSync(file, "utf8").slice(0, 700).trim();
      console.log(text || "(empty)");
    }
  }

  if (!models.length && !textures.length) {
    console.log(
      "\nStatus: no usable models or textures found. Recover or re-download the actual asset payload before GLB/PBR conversion.",
    );
    process.exitCode = 1;
  } else {
    console.log("\nStatus: usable source assets found.");
  }
}
