import { NextResponse } from "next/server";

import { getSyncStatusData } from "@/lib/data/sync-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSyncStatusData(), {
    // Uncached, every request was a fresh Supabase read for anyone who asked.
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
