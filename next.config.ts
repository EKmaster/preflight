import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium", "playwright"],
};

export default nextConfig;
