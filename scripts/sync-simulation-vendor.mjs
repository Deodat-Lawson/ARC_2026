#!/usr/bin/env node
/**
 * Copies Three.js + MapLibre from node_modules into public/simulation/vendor so the
 * plain-HTML simulation stack loads same-origin scripts (avoids Edge Tracking Prevention
 * + flaky CDN cache / ERR_CACHE_READ_FAILURE on unpkg).
 *
 * Run via postinstall / predev / prebuild. Skips work when versions match .vendor-stamp.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendorRoot = path.join(root, "public", "simulation", "vendor");
const stampPath = path.join(vendorRoot, ".vendor-stamp.json");

function readPkgVersion(pkgPath) {
  const raw = fs.readFileSync(pkgPath, "utf8");
  return JSON.parse(raw).version;
}

function stampDesired() {
  const threeV = readPkgVersion(path.join(root, "node_modules", "three", "package.json"));
  const mlV = readPkgVersion(path.join(root, "node_modules", "maplibre-gl", "package.json"));
  return { three: threeV, maplibreGl: mlV };
}

function upToDate(desired) {
  if (!fs.existsSync(stampPath)) return false;
  try {
    const cur = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    if (cur.three !== desired.three || cur.maplibreGl !== desired.maplibreGl) return false;
  } catch {
    return false;
  }
  const threeMod = path.join(vendorRoot, "three", "build", "three.module.js");
  const mlJs = path.join(vendorRoot, "maplibre-gl", "maplibre-gl.js");
  return fs.existsSync(threeMod) && fs.existsSync(mlJs);
}

function cpDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

const desired = stampDesired();

if (upToDate(desired)) {
  console.info("[sync-simulation-vendor] up to date, skip");
  process.exit(0);
}

const threeSrc = path.join(root, "node_modules", "three");
const mlDist = path.join(root, "node_modules", "maplibre-gl", "dist");

for (const p of [threeSrc, mlDist]) {
  if (!fs.existsSync(p)) {
    console.error(`[sync-simulation-vendor] missing ${path.relative(root, p)} — run npm install`);
    process.exit(1);
  }
}

fs.mkdirSync(vendorRoot, { recursive: true });

const threeDest = path.join(vendorRoot, "three");
fs.rmSync(threeDest, { recursive: true, force: true });
cpDir(path.join(threeSrc, "build"), path.join(threeDest, "build"));
cpDir(path.join(threeSrc, "examples", "jsm"), path.join(threeDest, "examples", "jsm"));

const mlDest = path.join(vendorRoot, "maplibre-gl");
fs.rmSync(mlDest, { recursive: true, force: true });
fs.mkdirSync(mlDest, { recursive: true });
fs.copyFileSync(path.join(mlDist, "maplibre-gl.js"), path.join(mlDest, "maplibre-gl.js"));
fs.copyFileSync(path.join(mlDist, "maplibre-gl.css"), path.join(mlDest, "maplibre-gl.css"));

fs.writeFileSync(stampPath, `${JSON.stringify(desired, null, 2)}\n`);
console.info("[sync-simulation-vendor] copied three + maplibre-gl → public/simulation/vendor");
