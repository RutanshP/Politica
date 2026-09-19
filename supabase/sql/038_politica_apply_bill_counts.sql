-- Bulk-merges cosponsor and amendment counts into bills.stats. Already applied.
--
-- Both counts come only from Congress.gov's per-bill detail endpoint. The detail normalizer read
-- cosponsors from the wrong field until recently (it counted `sponsors`, which only ever holds the
-- sponsor) and hard-coded amendments to 0, so 19,766 of 19,851 bills showed 0 cosponsors and every
-- bill showed 0 amendments. Both are fixed for bills synced from now on; this is how the one-time
-- backfill (one detail request per bill) writes what it fetched, a chunk per call.
create or replace function public.apply_bill_counts(p_counts jsonb)
returns integer
language sql
set search_path = public, pg_temp
as $$
  with incoming as (
    select id, cosponsors, amendments
    from jsonb_to_recordset(p_counts) as x(id text, cosponsors integer, amendments integer)
  ),
  changed as (
    update public.bills b
    set stats = coalesce(b.stats, '{}'::jsonb)
      || jsonb_build_object('cosponsors', i.cosponsors, 'amendments', i.amendments)
    from incoming i
    where b.id = i.id
      and (
        (b.stats ->> 'cosponsors')::int is distinct from i.cosponsors
        or (b.stats ->> 'amendments')::int is distinct from i.amendments
      )
    returning 1
  )
  select count(*)::integer from changed;
$$;

revoke execute on function public.apply_bill_counts(jsonb) from public, anon, authenticated;
grant execute on function public.apply_bill_counts(jsonb) to service_role;
