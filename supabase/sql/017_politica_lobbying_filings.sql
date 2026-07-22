-- Lobbying disclosure filings from the LDA REST API (https://lda.gov/api/v1).
--
-- The funding graph has modelled `lobbyingFirm` entities and `retained` / `lobbied_on` edges
-- since it was written, and the UI ships a Lobbying tab, an entity filter, and a "Lobbying
-- connections" toggle that defaults to on -- but nothing ever produced the data, because the only
-- graph sync reads the FEC, and the FEC does not collect lobbying. This is the missing source.
--
-- Filings are stored raw-ish and the graph edges are *computed* from them (see
-- lobbying_graph_rollup below) rather than accumulated edge-by-edge during ingestion. That is
-- deliberate: incrementally adding to a stored total is exactly how the politician vote-stat
-- counters drifted away from their source table, and a resumable page-by-page sync would hit the
-- same trap on every retry or overlapping run.
create table if not exists public.lobbying_filings (
  filing_uuid text primary key,
  filing_year integer not null,
  filing_type text,
  filing_period text,
  -- The registrant is the lobbying firm. For in-house lobbying the registrant and the client are
  -- the same organization, which is why is_in_house is derived and stored.
  registrant_id text,
  registrant_name text,
  client_id text,
  client_name text,
  is_in_house boolean not null default false,
  -- Firms report income received from a client; in-house filers report their own expenses.
  income numeric,
  expenses numeric,
  amount numeric,
  posted_at timestamptz,
  filing_url text,
  synced_at timestamptz not null default now()
);

create index if not exists lobbying_filings_year_idx on public.lobbying_filings (filing_year);
create index if not exists lobbying_filings_pair_idx
  on public.lobbying_filings (client_id, registrant_id);
create index if not exists lobbying_filings_client_name_idx
  on public.lobbying_filings (lower(client_name));

/*
 * Aggregates filings into one row per client/firm relationship for a set of years. This is the
 * shape the graph edges are built from: amount is the summed reported money, filing_count becomes
 * the edge's transaction_count.
 */
create or replace function public.lobbying_graph_rollup(p_years integer[] default null)
returns table (
  registrant_id text,
  registrant_name text,
  client_id text,
  client_name text,
  is_in_house boolean,
  total_amount numeric,
  filing_count bigint,
  first_year integer,
  last_year integer
)
language sql
stable
as $$
  select
    f.registrant_id,
    max(f.registrant_name) as registrant_name,
    f.client_id,
    max(f.client_name) as client_name,
    /*
     * Derived here rather than trusted from the column. Registrants and clients live in separate
     * id spaces, so an organization lobbying for itself appears with two different ids and the
     * same name -- name equality is the only signal, and deriving it keeps rows ingested before
     * that was understood from reporting the wrong answer.
     */
    bool_or(
      f.registrant_name is not null
      and f.client_name is not null
      and lower(f.registrant_name) = lower(f.client_name)
    ) as is_in_house,
    coalesce(sum(f.amount), 0) as total_amount,
    count(*) as filing_count,
    min(f.filing_year) as first_year,
    max(f.filing_year) as last_year
  from public.lobbying_filings f
  where (p_years is null or f.filing_year = any(p_years))
    and f.registrant_id is not null
    and f.client_id is not null
  group by f.registrant_id, f.client_id;
$$;
