import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * pdf.js reaches for Node built-ins and resolves its own worker at runtime, which the Server
   * Components bundler rewrites. Left bundled it fails only when actually invoked -- which is the
   * shape of what happened in production: amendment linking kept working while every text
   * extraction came back empty, because the caller treated a throw as "this amendment has no
   * text". Loading it through native require keeps it intact.
   */
  serverExternalPackages: ["pdfjs-dist"],
  /*
   * pdf.js 5+ needs DOMMatrix, which Node lacks, and fills it from @napi-rs/canvas -- loaded with a
   * createRequire() call the file tracer cannot follow. The package never shipped to Vercel, so
   * every PDF failed with "DOMMatrix is not defined": amendment text since at least 2026-08-31, and
   * the same 128 House disclosures re-marked extract_failed every night. The glob also picks up
   * the platform binary (canvas-linux-x64-gnu on Vercel).
   */
  outputFileTracingIncludes: {
    "/api/internal/sync/bill-amendments": ["./node_modules/@napi-rs/canvas*/**/*"],
    "/api/internal/sync/stock-disclosures": ["./node_modules/@napi-rs/canvas*/**/*"],
  },
  experimental: {
    /*
     * Page-data collection forks one worker per logical CPU by default. On a 16-thread machine
     * that is 15 workers, and the committees/[slug] prerender (380+ paths) pushed them past
     * available memory -- the build died with "Fatal process out of memory" rather than a
     * useful error. Capping the pool trades a little wall-clock time for a build that finishes.
     */
    cpus: 4,
  },
};

export default nextConfig;
