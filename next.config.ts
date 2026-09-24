import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the end-to-end test server run next to a normal dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Field crews upload phone photos through server actions.
    serverActions: { bodySizeLimit: "40mb" },
  },
};

export default nextConfig;
