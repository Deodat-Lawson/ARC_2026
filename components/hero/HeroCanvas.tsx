"use client";

import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor, Preload } from "@react-three/drei";
import { Suspense, useState } from "react";
import { Scene } from "./Scene";
import { DroneSwarm } from "./DroneSwarm";
import { ParticleField } from "./ParticleField";
import { CameraRig } from "./CameraRig";
import { DetectionHUD } from "./DetectionHUD";

/**
 * The R3F surface. Lighting is intentionally three-point cinematic:
 *
 *   - hemisphere ambient: cool blue sky / warm bounce
 *   - directional KEY from camera-right, slightly warm: sets the dominant shape
 *   - directional FILL from camera-left, cooler and dimmer: lifts shadows
 *   - directional RIM from behind, strong + warm: silhouettes drones and tops
 *
 * Fog is medium-warm to give atmospheric perspective: closer objects read
 * sharp, distant buildings dissolve into haze.
 *
 * Post-processing is gated until @react-three/postprocessing's version is
 * verified compatible with the installed R3F. See package.json comment.
 */
const ENABLE_POSTFX = false;

export function HeroCanvas() {
  const [dprMax, setDprMax] = useState(1.5);

  return (
    <Canvas
      dpr={[1, dprMax]}
      shadows={false}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        alpha: false,
      }}
      camera={{ fov: 38, near: 0.1, far: 500, position: [0, 4, 22] }}
    >
      <PerformanceMonitor
        onDecline={() => setDprMax(1)}
        onIncline={() => setDprMax(1.5)}
        flipflops={2}
      />

      <color attach="background" args={["#0a0c10"]} />
      <fog attach="fog" args={["#2a1d12", 18, 140]} />

      {/* KEY — warm, camera-right, high */}
      <directionalLight
        position={[18, 22, 8]}
        intensity={1.4}
        color="#ffc88a"
      />
      {/* FILL — cool, camera-left, low */}
      <directionalLight
        position={[-14, 9, 6]}
        intensity={0.45}
        color="#5a8cb8"
      />
      {/* RIM — strong, from behind */}
      <directionalLight
        position={[-2, 14, -32]}
        intensity={1.8}
        color="#ffb070"
      />
      {/* Sky/bounce */}
      <hemisphereLight args={["#5a6a78", "#1a1410", 0.35]} />

      <Suspense fallback={null}>
        <Scene />
        <DroneSwarm />
        <ParticleField />
        <DetectionHUD />
      </Suspense>

      <CameraRig />

      {ENABLE_POSTFX && <PostFX />}

      <Preload all />
    </Canvas>
  );
}

/**
 * Lazily-required post-FX stack. Only walked when ENABLE_POSTFX is true.
 */
function PostFX() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pp = require("@react-three/postprocessing");
  const { EffectComposer, Bloom, ChromaticAberration, Vignette } = pp;
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.4}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.2}
        mipmapBlur
      />
      <ChromaticAberration offset={[0.0012, 0.0012]} />
      <Vignette eskil={false} offset={0.15} darkness={0.85} />
    </EffectComposer>
  );
}
