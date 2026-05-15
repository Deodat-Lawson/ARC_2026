import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  async rewrites() {
    return [
      // Standalone 2D simulation demo (static HTML + module JS) served from /public/demo.
      // Next.js does not auto-resolve directory index files in /public, so we rewrite
      // the bare /demo URL to the actual file.
      { source: "/demo", destination: "/demo/index.html" },
    ];
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glb|gltf|hdr|exr|ktx2)$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
