import { NextResponse } from "next/server";

import { getNewsData } from "@/lib/data/news";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getNewsData());
}
