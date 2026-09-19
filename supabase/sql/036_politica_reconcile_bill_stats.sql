-- politicians.stats.billsPassed, recomputed from bills instead of accumulated. Already applied.
--
-- The bill sync kept this counter with +1/-1 deltas as bills changed status (politician-stat-
-- deltas.ts). Like the vote counters before 016 it drifted: on 2026-09-19, 126 of 559 federal
-- members were wrong, 136 passed bills stored against 319 actual. This derives it from the bills
-- themselves -- sponsored bills that passed a chamber or were signed, this Congress -- and the
-- legislation sync calls it after every write, so the delta path can no longer leave it wrong.
create or replace function public.reconcile_politician_bill_stats()
returns integer
language sql
set search_path = public, pg_temp
as $$
  with actual as (
    select p.id, coalesce(count(b.id) filter (where b.status in ('Passed Chamber', 'Signed')), 0)::int as passed
    from public.politicians p
    left join public.bills b on b.sponsor_id = p.id
    where p.jurisdiction_type = 'federal'
    group by p.id
  ),
  changed as (
    update public.politicians p
    set stats = jsonb_set(coalesce(p.stats, '{}'::jsonb), '{billsPassed}', to_jsonb(a.passed))
    from actual a
    where a.id = p.id
      and coalesce((p.stats ->> 'billsPassed')::int, -1) <> a.passed
    returning 1
  )
  select count(*)::integer from changed;
$$;

revoke execute on function public.reconcile_politician_bill_stats() from public, anon, authenticated;
grant execute on function public.reconcile_politician_bill_stats() to service_role;

select public.reconcile_politician_bill_stats();
