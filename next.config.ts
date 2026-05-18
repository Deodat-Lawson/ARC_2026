import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  async headers() {
    return [
      {
        source: "/simulation/data/:path*.glb",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, must-revalidate",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // Mission-command simulation (static HTML + module JS) served from /public/simulation.
      // Next.js does not auto-resolve directory index files in /public, so we rewrite
      // the bare /simulation URL to the actual file.
      { source: "/simulation", destination: "/simulation/index.html" },
    ];
  },
  async redirects() {
    return [
      // Legacy /demo URL — keep external links working after the rename.
      { source: "/demo", destination: "/simulation", permanent: false },
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
