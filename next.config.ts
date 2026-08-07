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
