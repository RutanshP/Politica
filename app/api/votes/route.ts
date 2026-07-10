import { NextResponse } from "next/server";

import { getVotesDataForBill, getVotesDataForPolitician } from "@/lib/data/votes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const billId = searchParams.get("billId");
  const politicianId = searchParams.get("politicianId");

  if (billId) {
    return NextResponse.json(await getVotesDataForBill(billId));
  }

  if (politicianId) {
    return NextResponse.json(await getVotesDataForPolitician(politicianId));
  }

  return NextResponse.json({ error: "Provide billId or politicianId" }, { status: 400 });
}
