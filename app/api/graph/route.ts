import { NextResponse } from "next/server";

import { getFundingGraphData } from "@/lib/data/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const politician = searchParams.get("politician") || undefined;
  return NextResponse.json(await getFundingGraphData(politician));
}
