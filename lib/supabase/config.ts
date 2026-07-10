function readEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export function getSupabaseUrl() {
  return readEnv("NEXT_PUBLIC_SUPABASE_URL") || readEnv("POLITICA_SUPABASE_URL");
}

export function getSupabasePublishableKey() {
  return readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    || readEnv("POLITICA_SUPABASE_PUBLISHABLE_KEY");
}

export function getSupabaseSecretKey() {
  return readEnv("SUPABASE_SECRET_KEY")
    || readEnv("POLITICA_SUPABASE_SECRET_KEY")
    || readEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function getSupabaseSchema() {
  return readEnv("POLITICA_SUPABASE_SCHEMA") || "public";
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseSecretKey());
}

export function getPoliticaSyncSecret() {
  return readEnv("POLITICA_SYNC_SECRET");
}
