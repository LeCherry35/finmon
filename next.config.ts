import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The receipt-scan prompt template is read from disk at runtime
  // (src/lib/receipt-scan.ts). Standalone output only copies traced files, so it
  // wouldn't otherwise be present in the container — force-include it for every
  // route's server trace. (The examples JSON is bundled via import, so it needs
  // no entry here.)
  outputFileTracingIncludes: {
    "/*": ["src/lib/receipt-prompt.md"],
  },
  experimental: {
    // Receipt scans post a downscaled JPEG as a data URL to a server action; the
    // 1MB default body limit is too tight once base64 overhead is added.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
