import { NextResponse } from "next/server";

import { getBillData } from "@/lib/data/bills";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ billId: string }> },
) {
  const { billId } = await context.params;
  const data = await getBillData(billId);

  if (!data.bill) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
