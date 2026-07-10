import { NextResponse } from "next/server";

import { getIssuesData } from "@/lib/data/issues";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getIssuesData());
}
