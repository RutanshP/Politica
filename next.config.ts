import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
