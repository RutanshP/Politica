import { NextResponse } from "next/server";

import { searchPolitica } from "@/lib/data/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  return NextResponse.json(await searchPolitica(q));
}
