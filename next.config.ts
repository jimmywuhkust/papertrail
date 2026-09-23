import type { NextConfig } from "next";

// GH_PAGES=true produces a static export for GitHub Pages (project site under
// /papertrail). The default build stays a Cloudflare Workers SSR deployment.
const githubPages = process.env.GH_PAGES === "true";

const nextConfig: NextConfig = githubPages
  ? {
      output: "export",
      trailingSlash: true,
      basePath: "/papertrail",
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
