import { NextResponse } from "next/server";

import { encodeNetwork, getCongressNetwork } from "@/lib/data/congress-network";

// Rebuilt at most every six hours; the PAC sync moves a few dozen members a day. The layout is
// computed here too, so a visitor never waits on it.
export const revalidate = 21600;

export async function GET() {
  const network = await getCongressNetwork();
  if (!network) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  return NextResponse.json(encodeNetwork(network));
}
