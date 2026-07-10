create table if not exists public.politicians (
  id text primary key,
  slug text not null unique,
  name text not null,
  title text not null,
  party text not null,
  state text not null,
  district text,
  biography text not null,
  born text not null,
  education text not null,
  occupation text not null,
  website text not null,
  office_phone text not null,
  office_address text not null,
  next_election text not null,
  stats jsonb not null default '{}'::jsonb,
  ideology jsonb not null default '{}'::jsonb,
  source text not null default 'congress_sync',
  synced_at timestamptz not null default timezone('utc', now()),
  raw_member jsonb
);

create index if not exists politicians_name_idx on public.politicians (name);
create index if not exists politicians_party_idx on public.politicians (party);
create index if not exists politicians_state_idx on public.politicians (state);
