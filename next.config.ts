import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glb|gltf|hdr|exr|ktx2)$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
