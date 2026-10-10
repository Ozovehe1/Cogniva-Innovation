import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / DOM-shimmed libraries used only on the server (board snapshots, exact maths diagrams).
  serverExternalPackages: ["@resvg/resvg-js", "@penrose/core", "linkedom", "@visioncortex/vtracer"],
  // The snapshot renderer loads its font from disk.
  outputFileTracingIncludes: {
    "/api/agent/**": ["./src/lib/agent/fonts/**"],
    "/api/tutor/**": ["./src/lib/agent/fonts/**"],
  },
};

export default nextConfig;
