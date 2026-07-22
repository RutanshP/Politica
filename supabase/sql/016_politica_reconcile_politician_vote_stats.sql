-- One-time (and repeatable) correction for counters that drifted while they were maintained by
-- addition instead of computed. See 015 for the mechanism.
--
-- Rewrites politicians.stats from politician_vote_stat_counters, and is safe to re-run: it only
-- writes rows whose stored counters actually disagree with the computed ones.
create or replace function public.reconcile_politician_vote_stats()
returns table (examined bigint, corrected bigint)
language plpgsql
as $$
declare
  v_examined bigint;
  v_corrected bigint;
begin
  /*
   * Left join, not inner: a member whose positions were all removed produces no row from the
   * counters function, and an inner join would leave their stale counters untouched forever --
   * the same "never revisited" gap that let the drift accumulate in the first place. They are
   * included via `stats ? 'totalVotes'` and reconciled down to zero.
   */
  create temporary table _reconcile on commit drop as
  select
    p.id,
    coalesce(c.total_votes, 0) as total_votes,
    coalesce(c.cast_votes, 0) as cast_votes,
    coalesce(c.with_party_count, 0) as with_party_count,
    coalesce(c.against_party_count, 0) as against_party_count,
    coalesce(c.with_party_count, 0) + coalesce(c.against_party_count, 0) as comparable
  from public.politicians p
  left join public.politician_vote_stat_counters() c on c.politician_id = p.id
  where c.politician_id is not null or p.stats ? 'totalVotes';

  select count(*) into v_examined from _reconcile;

  with updated as (
    update public.politicians p
    set stats = p.stats
      || jsonb_build_object(
        'totalVotes', r.total_votes,
        'castVotes', r.cast_votes,
        'withPartyCount', r.with_party_count,
        'againstPartyCount', r.against_party_count,
        -- No stored roll calls means no rate to report. Leaving the old percentage would show a
        -- member as 100% attending on the strength of zero votes.
        'attendance', case
          when r.total_votes > 0 then round(r.cast_votes::numeric / r.total_votes * 100)
          else 0
        end,
        'votesWithParty', case
          when r.comparable > 0 then round(r.with_party_count::numeric / r.comparable * 100)
          when r.total_votes = 0 then 0
          else coalesce((p.stats->>'votesWithParty')::numeric, 0)
        end,
        'votesAgainstParty', case
          when r.comparable > 0 then round(r.against_party_count::numeric / r.comparable * 100)
          when r.total_votes = 0 then 0
          else coalesce((p.stats->>'votesAgainstParty')::numeric, 0)
        end
      ),
      last_stats_recomputed_at = now(),
      synced_at = now()
    from _reconcile r
    where p.id = r.id
      -- Only touch rows that are actually wrong, so synced_at stays meaningful.
      and (
        coalesce((p.stats->>'totalVotes')::bigint, -1) is distinct from r.total_votes
        or coalesce((p.stats->>'castVotes')::bigint, -1) is distinct from r.cast_votes
        or coalesce((p.stats->>'withPartyCount')::bigint, -1) is distinct from r.with_party_count
        or coalesce((p.stats->>'againstPartyCount')::bigint, -1) is distinct from r.against_party_count
      )
    returning 1
  )
  select count(*) into v_corrected from updated;

  return query select v_examined, v_corrected;
end;
$$;
