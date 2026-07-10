import { NextResponse } from "next/server";

import { getPoliticianData } from "@/lib/data/politicians";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const data = await getPoliticianData(slug);

  if (!data.politician) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
