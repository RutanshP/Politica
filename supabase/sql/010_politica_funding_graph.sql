-- Funding-network graph schema (applied to Supabase as migrations
-- `funding_graph_schema` + `funding_graph_demo_fixture`).
--
-- graph_entities/graph_edges are a derived, query-optimized projection --
-- original source records live in funding_source_records (and, later,
-- dedicated FEC/lobbying tables written by a real finance sync).

create table public.graph_entities (
  id text primary key,
  slug text unique not null,
  entity_type text not null,
  label text not null,
  subtitle text,
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  source_system text not null,
  source_id text not null,
  source_url text,
  synced_at timestamptz not null default timezone('utc', now())
);

create table public.graph_edges (
  id text primary key,
  source_entity_id text not null references public.graph_entities(id) on delete cascade,
  target_entity_id text not null references public.graph_entities(id) on delete cascade,
  relationship_type text not null,
  relationship_direction text not null default 'directed',
  amount bigint,
  transaction_count integer,
  election_cycle integer,
  occurred_at timestamptz,
  start_date date,
  end_date date,
  is_aggregate boolean not null default false,
  confidence numeric,
  metadata jsonb not null default '{}'::jsonb,
  source_system text not null,
  source_id text not null,
  source_url text,
  synced_at timestamptz not null default timezone('utc', now())
);

create table public.entity_aliases (
  id text primary key,
  entity_id text not null references public.graph_entities(id) on delete cascade,
  alias text not null,
  alias_type text not null default 'name',
  source_system text not null,
  synced_at timestamptz not null default timezone('utc', now())
);

create table public.industry_classifications (
  id text primary key,
  code text unique not null,
  label text not null,
  sector text,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default timezone('utc', now())
);

-- Normalized underlying records backing graph edges (e.g. itemized FEC
-- Schedule A rows, lobbying filings). Edge detail UIs paginate over these.
create table public.funding_source_records (
  id text primary key,
  edge_id text not null references public.graph_edges(id) on delete cascade,
  record_type text not null,
  amount bigint,
  occurred_on date,
  contributor_name text,
  contributor_employer text,
  contributor_occupation text,
  recipient text,
  description text,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  source_system text not null,
  synced_at timestamptz not null default timezone('utc', now())
);

create index graph_entities_entity_type_idx on public.graph_entities (entity_type);
create index graph_edges_source_idx on public.graph_edges (source_entity_id);
create index graph_edges_target_idx on public.graph_edges (target_entity_id);
create index graph_edges_relationship_type_idx on public.graph_edges (relationship_type);
create index graph_edges_election_cycle_idx on public.graph_edges (election_cycle);
create index graph_edges_amount_idx on public.graph_edges (amount desc nulls last);
create index graph_edges_occurred_at_idx on public.graph_edges (occurred_at desc nulls last);
create index entity_aliases_entity_id_idx on public.entity_aliases (entity_id);
create index entity_aliases_alias_idx on public.entity_aliases (alias);
create index funding_source_records_edge_id_idx on public.funding_source_records (edge_id);

alter table public.graph_entities enable row level security;
alter table public.graph_edges enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.industry_classifications enable row level security;
alter table public.funding_source_records enable row level security;

create policy "public read" on public.graph_entities for select to anon, authenticated using (true);
create policy "public read" on public.graph_edges for select to anon, authenticated using (true);
create policy "public read" on public.entity_aliases for select to anon, authenticated using (true);
create policy "public read" on public.industry_classifications for select to anon, authenticated using (true);
create policy "public read" on public.funding_source_records for select to anon, authenticated using (true);

-- The demo fixture (source_system = 'demo_fixture') seeded for politician
-- O000172 lives in the `funding_graph_demo_fixture` migration; it is
-- intentionally not reproduced here since it is illustrative placeholder
-- data, not schema. Remove it once a real FEC sync populates these tables:
--   delete from public.graph_entities where source_system = 'demo_fixture';
