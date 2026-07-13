alter table if exists public.bills
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_fingerprint text,
  add column if not exists last_detail_synced_at timestamptz,
  add column if not exists last_actions_synced_at timestamptz,
  add column if not exists last_versions_synced_at timestamptz,
  add column if not exists last_votes_synced_at timestamptz;

alter table if exists public.politicians
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_fingerprint text,
  add column if not exists last_profile_synced_at timestamptz,
  add column if not exists last_stats_recomputed_at timestamptz;

create index if not exists bills_source_updated_at_idx
  on public.bills (source_updated_at desc);

create index if not exists bills_source_fingerprint_idx
  on public.bills (source_fingerprint);

create index if not exists politicians_source_updated_at_idx
  on public.politicians (source_updated_at desc);

create index if not exists politicians_source_fingerprint_idx
  on public.politicians (source_fingerprint);
