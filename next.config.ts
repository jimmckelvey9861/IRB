import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every IRB screen shows live, per-user data; nothing is prerendered or cached on the server.
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
