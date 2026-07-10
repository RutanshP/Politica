import { getPoliticaSyncSecret } from "@/lib/supabase/config";

export function isAuthorizedSyncRequest(request: Request) {
  const expectedSecret = getPoliticaSyncSecret();
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const headerSecret = request.headers.get("x-sync-secret") || "";
  const providedSecret = bearer || headerSecret;

  return Boolean(expectedSecret && providedSecret === expectedSecret);
}
