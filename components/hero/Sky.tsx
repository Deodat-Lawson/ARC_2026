"use client";

import { useMemo } from "react";
import { BackSide, Color, ShaderMaterial, Vector3 } from "three";

/**
 * Custom gradient sky with a soft warm sun disc. Reads like late-afternoon
 * dust haze — overcast top, warm tan horizon, low golden sun trying to break
 * through smoke. Gives the disaster scene a sense of "place" and time of day
 * that flat-color backgrounds can't.
 *
 * The sun direction is chosen so it sits in the upper-right of the camera's
 * default looking direction (camera looks ~-z), giving cinematic side-lighting
 * without competing with the rescue plaza for attention.
 *
 * Implementation: huge back-side sphere with a shader-based vertical gradient
 * + sun glow + halo + tight disc. No textures, no external assets.
 */

const SUN_DIRECTION = new Vector3(0.55, 0.32, -0.78).normalize();

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDir;

  varying vec3 vWorldPos;

  void main() {
    vec3 dir = normalize(vWorldPos);

    // Vertical gradient: below-horizon → horizon → mid → top
    float y = dir.y;
    vec3 color;
    if (y < 0.0) {
      // Below horizon — fade to dim warm ground haze
      float t = clamp((y + 0.18) / 0.18, 0.0, 1.0);
      color = mix(uHorizon * 0.35, uHorizon, t);
    } else if (y < 0.32) {
      // Horizon → mid
      float t = smoothstep(0.0, 1.0, y / 0.32);
      color = mix(uHorizon, uMid, t);
    } else {
      // Mid → top
      float t = smoothstep(0.0, 1.0, (y - 0.32) / 0.68);
      color = mix(uMid, uTop, t);
    }

    // Sun: tight bright disc + soft glow + wide halo
    float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
    float disc  = smoothstep(0.9985, 0.9994, sunDot);
    float glow  = pow(sunDot, 90.0);
    float halo  = pow(sunDot, 9.0);

    color = mix(color, uSun, halo * 0.35);
    color += uSun * glow * 0.7;
    color += vec3(1.0, 0.88, 0.7) * disc;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function Sky() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new Color("#11161c") },
          uMid: { value: new Color("#3a2e22") },
          uHorizon: { value: new Color("#8a5c34") },
          uSun: { value: new Color("#ffc88a") },
          uSunDir: { value: SUN_DIRECTION.clone() },
        },
        vertexShader,
        fragmentShader,
      }),
    [],
  );

  return (
    <mesh frustumCulled={false} renderOrder={-1000}>
      <sphereGeometry args={[450, 48, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
