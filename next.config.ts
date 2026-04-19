import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/** Avoid picking a parent-folder lockfile as Turbopack root on some setups */
const turbopackRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: turbopackRoot },
};

export default nextConfig;
