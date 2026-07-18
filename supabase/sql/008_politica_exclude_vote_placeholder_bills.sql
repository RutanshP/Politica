-- Remove vote-derived placeholder "bills" from the bills directory.
--
-- The federal vote sync used to create a placeholder bill for every roll call that had no linked
-- bill (a motion to proceed, a cloture vote, a nomination), purely to satisfy the old
-- votes.bill_id NOT NULL foreign key. Migration 007 made bill_id nullable, so these are obsolete
-- -- but ~578 of them still sit in the bills table, titled with the motion text ("Motion to
-- Proceed to S.J. Res. 198", "On Motion to Recommit", ...) and cluttering the directory.
--
-- They all carry sponsor_id = 'federal-vote-pending'.

-- ---------------------------------------------------------------------------
-- 1. Detach the votes so the cascade delete does not take the vote data with the bill.
-- ---------------------------------------------------------------------------
-- votes.bill_id references bills(id) ON DELETE CASCADE. These votes ARE the placeholder (vote id
-- == bill id), and the motion has no real bill, so null is the correct value now.
update public.votes v
set bill_id = null
where v.bill_id in (
  select id from public.bills where sponsor_id = 'federal-vote-pending'
);

-- ---------------------------------------------------------------------------
-- 2. Delete the placeholder bills.
-- ---------------------------------------------------------------------------
delete from public.bills where sponsor_id = 'federal-vote-pending';

-- ---------------------------------------------------------------------------
-- 3. Exclude them from the facet function (in case any are re-created before the code fix ships).
-- ---------------------------------------------------------------------------
create or replace function public.bill_directory_facets(p_session text)
returns table (facet text, value text)
language sql
stable
as $$
  with scoped as (
    select *
    from public.bills
    where sponsor_id <> 'federal-vote-pending'
      and (
        jurisdiction_type = 'state'
        or (jurisdiction_type = 'federal' and session = p_session)
      )
  )
  select 'level'::text,     case when jurisdiction_type = 'state' then 'State' else 'Federal' end
    from scoped group by 1, 2
  union all
  select 'state'::text,     state          from scoped where state          is not null and state          <> '' group by 1, 2
  union all
  select 'chamber'::text,   chamber        from scoped where chamber        is not null and chamber        <> '' group by 1, 2
  union all
  select 'status'::text,    status         from scoped where status         is not null and status         <> '' group by 1, 2
  union all
  select 'session'::text,   session        from scoped where session        is not null and session        <> '' group by 1, 2
  union all
  select 'topic'::text,     topic          from scoped where topic          is not null and topic          <> '' group by 1, 2
  union all
  select 'sponsor'::text,   sponsor_name   from scoped where sponsor_name   is not null and sponsor_name   <> '' group by 1, 2
  union all
  select 'committee'::text, committee_name from scoped where committee_name is not null and committee_name <> '' group by 1, 2
  order by 1, 2;
$$;

analyze public.bills;
