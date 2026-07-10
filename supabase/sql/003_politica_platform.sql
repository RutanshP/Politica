create table if not exists public.jurisdictions (
  id text primary key,
  slug text not null unique,
  name text not null,
  jurisdiction_type text not null,
  country text not null,
  state_code text,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.legislative_sessions (
  id text primary key,
  slug text not null unique,
  jurisdiction_id text not null references public.jurisdictions (id) on delete cascade,
  name text not null,
  session_code text not null,
  start_date date,
  end_date date,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

alter table public.politicians
  add column if not exists source_system text default 'congress_sync',
  add column if not exists source_id text default '',
  add column if not exists jurisdiction_type text default 'federal',
  add column if not exists state_code text,
  add column if not exists session_id text,
  add column if not exists raw_payload jsonb;

alter table public.bills
  add column if not exists slug text,
  add column if not exists source_system text default 'congress_sync',
  add column if not exists source_id text default '',
  add column if not exists jurisdiction_type text default 'federal',
  add column if not exists state_code text,
  add column if not exists session_id text,
  add column if not exists raw_payload jsonb;

alter table public.committees
  add column if not exists source_system text default 'congress_sync',
  add column if not exists source_id text default '',
  add column if not exists jurisdiction_type text default 'federal',
  add column if not exists state_code text,
  add column if not exists session_id text,
  add column if not exists raw_payload jsonb;

create table if not exists public.committee_members (
  committee_id text not null references public.committees (id) on delete cascade,
  politician_id text not null references public.politicians (id) on delete cascade,
  role text not null default 'member',
  sort_order integer not null default 0,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb,
  primary key (committee_id, politician_id)
);

create table if not exists public.votes (
  id text primary key,
  bill_id text not null references public.bills (id) on delete cascade,
  canonical_id text,
  bill_number text not null,
  title text not null,
  chamber text not null,
  date_label text not null,
  result text not null,
  yea integer not null default 0,
  nay integer not null default 0,
  present integer not null default 0,
  not_voting integer not null default 0,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.vote_positions (
  vote_id text not null references public.votes (id) on delete cascade,
  politician_id text not null references public.politicians (id) on delete cascade,
  name text not null,
  party text not null,
  state text not null,
  vote text not null,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb,
  primary key (vote_id, politician_id)
);

create table if not exists public.issues (
  id text primary key,
  slug text not null unique,
  name text not null,
  description text not null,
  stats jsonb not null default '{}'::jsonb,
  top_bill_ids jsonb not null default '[]'::jsonb,
  committee_ids jsonb not null default '[]'::jsonb,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.issue_bill_links (
  issue_id text not null references public.issues (id) on delete cascade,
  bill_id text not null references public.bills (id) on delete cascade,
  sort_order integer not null default 0,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb,
  primary key (issue_id, bill_id)
);

create table if not exists public.news_items (
  id text primary key,
  canonical_id text,
  headline text not null,
  source text not null,
  published_at text not null,
  related_ids jsonb not null default '[]'::jsonb,
  summary text not null,
  url text,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.news_entity_links (
  news_item_id text not null references public.news_items (id) on delete cascade,
  entity_id text not null,
  entity_type text not null,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb,
  primary key (news_item_id, entity_id)
);

create table if not exists public.finance_entities (
  id text primary key,
  slug text not null unique,
  label text not null,
  entity_type text not null,
  detail text not null,
  amount text,
  href text,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.finance_edges (
  id text primary key,
  source text not null,
  target text not null,
  label text not null,
  amount bigint not null default 0,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.candidate_finance_snapshots (
  id text primary key,
  politician_id text not null references public.politicians (id) on delete cascade,
  election_cycle text not null,
  receipts bigint not null default 0,
  disbursements bigint not null default 0,
  cash_on_hand bigint not null default 0,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.search_documents (
  id text primary key,
  entity_id text not null,
  entity_type text not null,
  label text not null,
  title text not null,
  description text not null,
  href text not null,
  meta text not null,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.analytics_snapshots (
  id text primary key,
  key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.entities (
  id text primary key,
  entity_type text not null,
  label text not null,
  title text not null,
  description text not null,
  href text not null,
  meta text not null,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.entity_relationships (
  id text primary key,
  source_entity_id text not null,
  target_entity_id text not null,
  relationship_type text not null,
  weight integer not null default 0,
  source_system text not null,
  source_id text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb
);

create table if not exists public.sync_runs (
  id text primary key,
  pipeline text not null,
  status text not null,
  record_count integer not null default 0,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.sync_errors (
  id text primary key,
  pipeline text not null,
  stage text not null,
  message text not null,
  payload jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists bills_slug_idx on public.bills (slug);
create index if not exists bills_session_id_idx on public.bills (session_id);
create index if not exists politicians_session_id_idx on public.politicians (session_id);
create index if not exists committees_session_id_idx on public.committees (session_id);
create index if not exists votes_bill_id_idx on public.votes (bill_id);
create index if not exists votes_date_label_idx on public.votes (date_label);
create index if not exists vote_positions_politician_id_idx on public.vote_positions (politician_id);
create index if not exists news_items_published_at_idx on public.news_items (published_at);
create index if not exists search_documents_entity_type_idx on public.search_documents (entity_type);
create index if not exists entities_entity_type_idx on public.entities (entity_type);
create index if not exists sync_runs_pipeline_idx on public.sync_runs (pipeline);
