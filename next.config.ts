import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Receipt scans post a downscaled JPEG as a data URL to a server action; the
    // 1MB default body limit is too tight once base64 overhead is added.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
