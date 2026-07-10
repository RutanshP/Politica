import { NextResponse } from "next/server";

import { getCommitteesData } from "@/lib/data/committees";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCommitteesData());
}
