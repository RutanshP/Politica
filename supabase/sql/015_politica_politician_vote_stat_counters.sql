-- Vote-stat counters were maintained incrementally in application code: each sync built counters
-- for the batch it had just ingested and *added* them to the stored values
-- (applyVotePositionDeltaToPoliticians). There was no idempotency guard, so re-ingesting a roll
-- call -- which happens whenever a vote is reclassified as changed -- counted its positions again.
-- vote_positions is keyed and upserts cleanly, so the source of truth stayed correct while the
-- counters drifted away from it: of 550 federal members with stats, only 52 had a denominator
-- matching their stored positions. 296 were overcounted, 202 undercounted.
--
-- This computes the counters from vote_positions instead. Aggregating in Postgres keeps it cheap
-- to call for a subset of members after a sync (the alternative, pulling every position row into
-- the app to recompute, is exactly the egress the incremental path was avoiding).
--
-- Definitions match the previous JS accumulator exactly:
--   total_votes   every stored position for the member
--   cast_votes    anything other than "Not Voting" (Present counts as showing up)
--   with/against  compared against the member's own party's majority on that roll call, skipping
--                 Present/Not Voting and roll calls where the party split evenly
create or replace function public.politician_vote_stat_counters(p_politician_ids text[] default null)
returns table (
  politician_id text,
  total_votes bigint,
  cast_votes bigint,
  with_party_count bigint,
  against_party_count bigint
)
language sql
stable
as $$
  with scoped as (
    select
      vp.politician_id,
      vp.vote_id,
      vp.vote,
      upper(left(coalesce(vp.party, ''), 1)) as party_code
    from public.vote_positions vp
    where p_politician_ids is null or vp.politician_id = any(p_politician_ids)
  ),
  -- Party majority is computed over every position on the roll call, not just the scoped members,
  -- so passing a subset of politicians cannot change the answer for any of them.
  party_tallies as (
    select
      vp.vote_id,
      upper(left(coalesce(vp.party, ''), 1)) as party_code,
      count(*) filter (where vp.vote = 'Yea') as yea,
      count(*) filter (where vp.vote = 'Nay') as nay
    from public.vote_positions vp
    where vp.vote in ('Yea', 'Nay')
      and coalesce(vp.party, '') <> ''
      and vp.vote_id in (select vote_id from scoped)
    group by 1, 2
  ),
  party_majority as (
    select
      vote_id,
      party_code,
      case when yea = nay then null when yea > nay then 'Yea' else 'Nay' end as majority_vote
    from party_tallies
  )
  select
    s.politician_id,
    count(*) as total_votes,
    count(*) filter (where s.vote <> 'Not Voting') as cast_votes,
    count(*) filter (
      where m.majority_vote is not null
        and s.vote not in ('Present', 'Not Voting')
        and s.vote = m.majority_vote
    ) as with_party_count,
    count(*) filter (
      where m.majority_vote is not null
        and s.vote not in ('Present', 'Not Voting')
        and s.vote <> m.majority_vote
    ) as against_party_count
  from scoped s
  left join party_majority m
    on m.vote_id = s.vote_id
   and m.party_code = s.party_code
  group by 1;
$$;
