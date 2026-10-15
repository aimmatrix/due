import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second local server (e.g. the e2e run) build into its own folder instead of sharing .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native SQLite driver must stay a runtime require, not be bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
