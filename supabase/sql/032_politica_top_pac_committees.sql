-- The committees that gave the most to sitting members in a cycle, for the Money dashboard's
-- "PACs giving the most to Congress" table (lib/data/money.ts getTopPacs). Already applied.
--
-- Aggregated here rather than in the app: ~97k pac_contributions rows would otherwise be read
-- over the wire to produce ten. ~0.35s once pac_contributions has statistics -- it had none when
-- first created and the same call took 2.1s, so the tables were ANALYZEd after the backfill.
--
-- Service role only, like the other RPCs behind the dashboards; the publishable key has no reason
-- to call it.

create or replace function public.top_pac_committees(p_cycle smallint, p_limit integer default 10)
returns table (
  committee_id text,
  name text,
  category text,
  sponsor_politician_id text,
  total numeric,
  members bigint,
  dem_total numeric,
  rep_total numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    c.committee_id,
    c.name,
    c.category,
    c.sponsor_politician_id,
    sum(pc.total) as total,
    count(*) as members,
    coalesce(sum(pc.total) filter (where p.party ilike 'dem%'), 0) as dem_total,
    coalesce(sum(pc.total) filter (where p.party ilike 'rep%'), 0) as rep_total
  from public.pac_contributions pc
  join public.pac_committees c using (committee_id)
  join public.politicians p on p.id = pc.politician_id
  where pc.cycle = p_cycle
  group by c.committee_id, c.name, c.category, c.sponsor_politician_id
  order by sum(pc.total) desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke execute on function public.top_pac_committees(smallint, integer) from public, anon, authenticated;
grant execute on function public.top_pac_committees(smallint, integer) to service_role;

analyze public.pac_contributions;
analyze public.pac_committees;
