"use client";

import {
  MeshStandardMaterial,
  Texture,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

/**
 * Triplanar PBR material. Samples basecolor / normal / roughness by world
 * position projected onto the three cardinal planes, then blends by surface
 * normal. The result: tile-able PBR textures wrap any geometry believably
 * regardless of the source UV layout. This is the production fix for
 * "imported geometry has broken/missing UVs".
 *
 * Built by hooking MeshStandardMaterial via onBeforeCompile — we keep the
 * full PBR lighting model and only swap the texture sampling chunks.
 */
type TriplanarSpec = {
  basecolor: Texture;
  normalMap?: Texture;
  roughnessMap?: Texture;
  /** World-space tile scale. Lower = bigger features. Default 0.18 ≈ ~5m per repeat. */
  scale?: number;
  /** Tint multiplier on top of basecolor (e.g., subtle warmth) */
  tint?: string;
  /** Default roughness when no roughness map */
  roughness?: number;
  /** Metalness scalar (multiplies metallic map if present) */
  metalness?: number;
  /** Strength of triplanar blend bias (sharper = higher) */
  blendBias?: number;
  /** Name for shader cache key */
  name?: string;
};

function configureTexture(t: Texture, srgb = false) {
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createTriplanarMaterial({
  basecolor,
  normalMap,
  roughnessMap,
  scale = 0.18,
  tint = "#ffffff",
  roughness = 0.95,
  metalness = 0.0,
  blendBias = 6.0,
  name = "triplanar",
}: TriplanarSpec): MeshStandardMaterial {
  configureTexture(basecolor, true);
  if (normalMap) configureTexture(normalMap, false);
  if (roughnessMap) configureTexture(roughnessMap, false);

  const mat = new MeshStandardMaterial({
    map: basecolor,
    normalMap: normalMap ?? null,
    roughnessMap: roughnessMap ?? null,
    color: tint,
    roughness,
    metalness,
  });
  mat.name = name;

  // Uniforms we add into the shader
  const uniforms = {
    uTriplanarScale: { value: scale },
    uBlendBias: { value: blendBias },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTriplanarScale = uniforms.uTriplanarScale;
    shader.uniforms.uBlendBias = uniforms.uBlendBias;

    // ----- VERTEX SHADER: emit world position + world normal -----
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `
      #include <common>
      varying vec3 vTriWorldPos;
      varying vec3 vTriWorldNormal;
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vTriWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      vTriWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
      `,
    );

    // ----- FRAGMENT SHADER: triplanar sampling -----
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `
      #include <common>
      uniform float uTriplanarScale;
      uniform float uBlendBias;
      varying vec3 vTriWorldPos;
      varying vec3 vTriWorldNormal;

      vec3 triBlendWeights() {
        vec3 n = abs( vTriWorldNormal );
        n = pow( n, vec3( uBlendBias ) );
        return n / max( ( n.x + n.y + n.z ), 0.0001 );
      }

      vec4 triSample( sampler2D tex ) {
        vec3 w = triBlendWeights();
        vec3 p = vTriWorldPos * uTriplanarScale;
        vec4 cX = texture2D( tex, p.zy );
        vec4 cY = texture2D( tex, p.xz );
        vec4 cZ = texture2D( tex, p.xy );
        return cX * w.x + cY * w.y + cZ * w.z;
      }
      `,
    );

    // Replace diffuse map sample
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = triSample( map );
        diffuseColor *= sampledDiffuseColor;
      #endif
      `,
    );

    // Replace normal map sample (use sampled normal as a per-plane perturbation)
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `
      #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 mapN = triSample( normalMap ).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        normal = normalize( normal + mapN * 0.6 );
      #endif
      `,
    );

    // Replace roughness map sample
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = triSample( roughnessMap );
        roughnessFactor *= texelRoughness.g;
      #endif
      `,
    );
  };

  // Cache key so multiple instances with the same config share compiled shaders
  mat.customProgramCacheKey = () => `triplanar-${name}`;

  return mat;
}
