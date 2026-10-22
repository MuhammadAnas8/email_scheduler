import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Google returns a short-lived authorization code and state in this URL.
  logging: {
    incomingRequests: {
      ignore: [/^\/api\/auth\/google\/callback(?:\?|$)/],
    },
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
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
