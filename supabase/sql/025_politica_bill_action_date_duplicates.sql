-- Removes the duplicate bill actions left by a timezone bug in the sync. Already applied; kept
-- here as the record. 4,144 rows deleted across ~1,100 bills, none of them real events.
--
-- The bug: formatDisplayDate (lib/normalizers/bills.ts) rendered the stored date string with
-- Intl.DateTimeFormat and no timeZone, so it used whatever zone the sync happened to run in.
-- Congress.gov sends "2026-07-22", which `new Date` reads as UTC midnight -- that renders "Jul 22"
-- on Vercel and "Jul 21" on a US-local machine, and timestamped values drift the other way.
--
-- That alone would only be cosmetic. What made it multiply is that bill actions are appended, not
-- replaced, and the writers decided "already stored?" by testing `date|label|detail|type` against a
-- Set. Move the rendered date and every action on the bill misses its signature and is appended a
-- second time. S.5123 ended up with its three actions stored six times over two dates.
--
-- Measured before the cleanup: 4,199 duplicated actions across 1,190 bills, 4,132 of them exactly
-- one day apart, including pairs that cannot happen twice -- "Introduced in Senate" on 604 House
-- bills and 430 Senate bills.
--
-- Fixed at the source in the same change: formatDisplayDate and both state displayDate helpers pin
-- timeZone to UTC, so the string is a function of the source value rather than of where the sync
-- ran; and createBillActionIndex replaces the ad-hoc Set, comparing the same normalized text the
-- read path uses so a Congressional Record citation on one copy no longer reads as a new action.
--
-- Which copy to delete was decided per bill rather than guessed. bills.last_action_on is a real
-- timestamptz written from the source date, so it is unaffected by the rendering bug: comparing it
-- to the bill's latest stored action date gives that bill's shift (0 or +1 day), and the copy on
-- the wrong side of it is the artifact. 535 bills were shifted one way, 559 the other -- consistent
-- with syncs run from both a UTC host and a US-local one, and the reason a blanket "keep the
-- earlier date" rule would have been wrong half the time.
--
-- Restricted to bills with at least two duplicated actions. The bug re-appends a bill's whole
-- action list, so that shape is its signature: 994 bills had every action duplicated and 102 had
-- several. A bill with exactly one duplicated action is ambiguous and was left alone.
--
-- Deliberately still present afterwards: 114 groups where the same action really does sit on more
-- than one date. Committee markup sessions run over consecutive days, "Committee Hearings Held."
-- recurs 63 days later, measures are "Considered by Senate." more than once. Those are real, which
-- is also why dedupeBillActions still matches on an exact date rather than a window -- collapsing
-- on text alone would delete history.

-- ---------------------------------------------------------------------------
-- PASS 1 -- exact duplicate text on two dates a day apart
-- ---------------------------------------------------------------------------
with shift_by_bill as (
  select b.id as bill_id,
         max(a.date::date) - (b.last_action_on at time zone 'UTC')::date as shift
  from public.bills b join public.bill_actions a on a.bill_id = b.id
  where b.last_action_on is not null
  group by b.id, b.last_action_on
), pairs as (
  select bill_id, detail, label, type, min(date::date) as d_min, max(date::date) as d_max
  from public.bill_actions group by 1,2,3,4
  having count(distinct date) = 2 and (max(date::date) - min(date::date)) = 1
), block_bills as (
  select bill_id from pairs group by bill_id having count(*) >= 2
), doomed as (
  select a.bill_id, a.sort_order
  from public.bill_actions a
  join pairs p on p.bill_id=a.bill_id and p.detail=a.detail and p.label=a.label and p.type=a.type
  join shift_by_bill o on o.bill_id = a.bill_id
  where a.bill_id in (select bill_id from block_bills)
    and o.shift in (0, 1)
    and a.date::date = case when o.shift = 0 then p.d_min else p.d_max end
)
delete from public.bill_actions a using doomed d
where a.bill_id = d.bill_id and a.sort_order = d.sort_order;

-- ---------------------------------------------------------------------------
-- PASS 2 -- the same, after normalizing the text the way the app compares it
-- ---------------------------------------------------------------------------
-- Pass 1 grouped on the raw detail, so a pair that also differed by a "Passed/agreed to in Senate:"
-- prefix or a "(consideration: CR S4273-4274)" suffix slipped through it. This mirrors
-- stripActionRestatement in lib/normalizers/legislation.ts.
with norm as (
  select bill_id, sort_order, date,
         btrim(regexp_replace(
           regexp_replace(
             regexp_replace(detail, '^(passed/agreed to in (house|senate):|resolving differences\s*--\s*(house|senate) actions:)\s*', '', 'i'),
             '\s*\((consideration|text|cr)\s*:[^()]*\)\s*$', '', 'i'),
           '\s+', ' ', 'g')) as d
  from public.bill_actions
), pairs as (
  select bill_id, lower(d) as dk, min(date::date) as d_min, max(date::date) as d_max
  from norm group by 1,2
  having count(distinct date::date) = 2 and (max(date::date) - min(date::date)) = 1
), shift_by_bill as (
  select b.id as bill_id, max(a.date::date) - (b.last_action_on at time zone 'UTC')::date as shift
  from public.bills b join public.bill_actions a on a.bill_id = b.id
  where b.last_action_on is not null group by b.id, b.last_action_on
), doomed as (
  select n.bill_id, n.sort_order
  from norm n
  join pairs p on p.bill_id=n.bill_id and p.dk = lower(n.d)
  join shift_by_bill o on o.bill_id = n.bill_id
  where o.shift in (0,1)
    and n.date::date = case when o.shift = 0 then p.d_min else p.d_max end
)
delete from public.bill_actions a using doomed d
where a.bill_id = d.bill_id and a.sort_order = d.sort_order;

-- Leaves gaps in sort_order, which is harmless: it is half the primary key and only ever used for
-- ordering, never as a count or an index into anything.
