create table if not exists public.bills (
  id text primary key,
  number text not null,
  title text not null,
  summary text not null,
  jurisdiction text not null,
  country text not null,
  state text,
  chamber text not null,
  status text not null,
  topic text not null,
  sponsor_id text not null,
  sponsor_name text not null,
  committee_id text not null,
  committee_name text not null,
  latest_action text not null,
  last_action_at text not null,
  introduced_at text not null,
  session text not null,
  chance_of_passing integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  related_bill_ids jsonb not null default '[]'::jsonb,
  source text not null default 'congress_sync',
  synced_at timestamptz not null default timezone('utc', now()),
  raw_bill jsonb
);

create table if not exists public.bill_actions (
  bill_id text not null references public.bills (id) on delete cascade,
  sort_order integer not null,
  date text not null,
  label text not null,
  detail text not null,
  type text not null,
  primary key (bill_id, sort_order)
);

create table if not exists public.bill_versions (
  bill_id text not null references public.bills (id) on delete cascade,
  version_id text not null,
  sort_order integer not null,
  label text not null,
  date text not null,
  type text not null,
  content jsonb not null default '[]'::jsonb,
  primary key (bill_id, version_id)
);

create table if not exists public.committees (
  id text primary key,
  slug text not null unique,
  name text not null,
  chamber text not null,
  jurisdiction text not null,
  chair text not null,
  ranking_member text not null,
  description text not null,
  hearing text not null,
  active_bill_ids jsonb not null default '[]'::jsonb,
  member_ids jsonb not null default '[]'::jsonb,
  source text not null default 'congress_sync',
  synced_at timestamptz not null default timezone('utc', now()),
  raw_committee jsonb
);

create index if not exists bills_status_idx on public.bills (status);
create index if not exists bills_topic_idx on public.bills (topic);
create index if not exists bills_sponsor_id_idx on public.bills (sponsor_id);
create index if not exists bills_committee_id_idx on public.bills (committee_id);
create index if not exists committees_name_idx on public.committees (name);
create index if not exists committees_chamber_idx on public.committees (chamber);
