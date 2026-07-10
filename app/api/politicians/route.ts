import { NextResponse } from "next/server";

import { getPoliticiansData } from "@/lib/data/politicians";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPoliticiansData();
  return NextResponse.json(data);
}
