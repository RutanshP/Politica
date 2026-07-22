-- State roll calls were indistinguishable from federal ones once stored.
--
-- `state-vote-sync.ts` rewrote OpenStates' organization classification into the federal words
-- ("upper" -> "Senate", "lower" -> "House"), the votes table carried no jurisdiction column, and
-- bill_id is null for state roll calls whose bill was never imported -- which is nearly all of
-- them, since state bills are not synced. That left `source_system` as the only discriminator,
-- and no read path filtered on it.
--
-- The visible effect: 2,481 rows answered to chamber='Senate' when only 789 are US Senate roll
-- calls. The largest single block was the California State Senate (1,565), and 881 California and
-- New York *Assembly* votes were filed as "House".
alter table public.votes
  add column if not exists jurisdiction_type text,
  add column if not exists state_code text;

-- Federal: the two authoritative federal feeds.
update public.votes
set jurisdiction_type = 'federal'
where source_system in ('senate_lis', 'house_clerk')
  and jurisdiction_type is distinct from 'federal';

-- State: everything from OpenStates.
update public.votes
set jurisdiction_type = 'state'
where source_system = 'openstates'
  and jurisdiction_type is distinct from 'state';

/*
 * Resolve each state roll call to its state.
 *
 * The vote's raw payload names the chamber organization it was taken in
 * (raw_payload->organization->id). State committees store that same organization id as their
 * parent, alongside a state_code -- so the committees table is the bridge from an OCD
 * organization back to a state. Nothing else in the schema connects them.
 */
with org_state as (
  select distinct
    raw_committee->>'parent_id' as org_id,
    state_code
  from public.committees
  where jurisdiction_type = 'state'
    and raw_committee->>'parent_id' is not null
    and state_code is not null
)
update public.votes v
set state_code = os.state_code
from org_state os
where v.source_system = 'openstates'
  and v.state_code is null
  and os.org_id = v.raw_payload->'organization'->>'id';

-- Fallback for state roll calls that did keep a bill link (the Wyoming set).
update public.votes v
set state_code = b.state
from public.bills b
where v.state_code is null
  and v.jurisdiction_type = 'state'
  and b.id = v.bill_id
  and b.state is not null;

/*
 * Chamber normalization, matching what the committees directory does: OpenStates' upper/lower is
 * the same distinction as Senate/House in different vocabulary. With jurisdiction_type and
 * state_code now present, "Senate" is no longer ambiguous -- a California Senate vote is
 * jurisdiction_type='state', state_code='CA'.
 *
 * This also repairs the rows written by state-sync.ts, which stored the raw upper/lower values
 * because it never applied the mapping the other writer did.
 */
update public.votes
set chamber = case
  when lower(chamber) in ('upper', 'senate') then 'Senate'
  when lower(chamber) in ('lower', 'house', 'assembly') then 'House'
  when lower(chamber) = 'joint' then 'Joint'
  else chamber
end
where lower(chamber) in ('upper', 'lower', 'assembly');

create index if not exists votes_jurisdiction_idx
  on public.votes (jurisdiction_type, chamber);

analyze public.votes;
