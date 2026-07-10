import { NextResponse } from "next/server";

import { getBillsData } from "@/lib/data/bills";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getBillsData());
}
