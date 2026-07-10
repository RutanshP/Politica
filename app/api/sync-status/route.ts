import { NextResponse } from "next/server";

import { getSyncStatusData } from "@/lib/data/sync-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSyncStatusData());
}
