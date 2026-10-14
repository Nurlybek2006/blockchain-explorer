import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  distDir: process.env.WEB_BUILD_DIR ?? '.next',
  typescript: { tsconfigPath: process.env.WEB_TSCONFIG_PATH ?? 'tsconfig.json' },
  poweredByHeader: false,
};

export default nextConfig;
