import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver must stay a runtime require, not be bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
