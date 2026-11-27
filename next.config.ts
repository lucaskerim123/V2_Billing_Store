import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/admin/integrations": ["./src/integrations/**/manifest.json"]
  }
};

export default nextConfig;
