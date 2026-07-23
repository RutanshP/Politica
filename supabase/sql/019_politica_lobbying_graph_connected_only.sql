-- Restrict the lobbying rollup to relationships that connect to a politician.
--
-- The funding graph is a breadth-first walk out from a politician, so a lobbying client that does
-- not bridge to an existing FEC employer node is an unreachable island: no traversal can surface
-- it. Of 28,098 registrant/client relationships only ~807 bridge, and materializing the rest was
-- ~45MB of dead weight in graph_entities/graph_edges that nothing reads.
--
-- Filtering here has a second benefit: the result drops under PostgREST's default 1000-row
-- response cap, which had been silently truncating the rollup to an arbitrary 1000 rows -- so only
-- 37 of the 807 real bridges were ever materialized.
--
-- The bridge id mirrors slugifySegment(client_name) in lib/utils.ts (lowercase, strip everything
-- but [a-z0-9 -], trim, collapse whitespace to '-'). rebuildLobbyingGraph re-derives the same
-- match in JS and is the final authority; this filter just keeps the payload small.
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
  with grouped as (
    select
      f.registrant_id,
      max(f.registrant_name) as registrant_name,
      f.client_id,
      max(f.client_name) as client_name,
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
    group by f.registrant_id, f.client_id
  )
  select
    g.registrant_id,
    g.registrant_name,
    g.client_id,
    g.client_name,
    g.is_in_house,
    g.total_amount,
    g.filing_count,
    g.first_year,
    g.last_year
  from grouped g
  where exists (
    select 1
    from public.graph_entities e
    where e.entity_type = 'employer'
      and e.id = 'fec-emp-' || regexp_replace(
        btrim(regexp_replace(lower(coalesce(g.client_name, '')), '[^a-z0-9 -]', '', 'g')),
        '\s+', '-', 'g')
  )
  order by g.total_amount desc;
$$;
