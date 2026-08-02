-- Storage reclaim, third pass. The database had grown from 300MB (after 022, on 2026-07-22) to
-- 672MB. This took it to 417MB. Already applied to the project -- kept here as the record.
--
-- The cause was one column, and it is the same defect 018 and 022 each fixed on a different table:
-- a `raw_payload` blob that no read path ever selects, written on every sync.
--
-- 018 nulled votes.raw_payload -- the parent roll call -- and stopped there. It missed
-- vote_positions.raw_payload, the child table, which is where the volume actually is: one row per
-- voter rather than one per roll call. It stayed ~375 bytes on 618k rows, so the miss was 83MB
-- against the 26MB that 018 reclaimed. 018 even ran `vacuum analyze public.vote_positions` without
-- noticing the column.
--
-- What made it show up as a sudden jump rather than a drift: the OpenStates state-vote sync
-- imported 160,504 positions on 07-31 and 69,285 on 08-02, each carrying a payload. Before 07-28
-- no vote_positions row had one at all.
--
-- Nothing read any of it. The only consumer is `rawAvailable: Boolean(row.raw_payload)`, a badge no
-- component renders -- and votePositionDisplaySelect stopped selecting the column during the egress
-- work, so the flag has been evaluating false against an absent field for some time already.
--
-- The writers are fixed first, or this regrows: legislation-sync.ts (federal positions, committee
-- rosters, placeholder members), state-vote-sync.ts and state-sync.ts (OpenStates positions, bills,
-- politicians, committees, memberships), election-candidates-sync.ts. Each now writes null, with
-- the key still present -- PostgREST rejects a bulk upsert whose objects don't all share keys
-- (PGRST102).
--
-- Measured, before -> after:
--   vote_positions   368MB -> 206MB   (heap 240 -> 111, indexes 128 -> 96)
--   bills            116MB ->  42MB   (18MB of legacy raw_payload that 022 left behind, plus the
--                                      heap bloat under it -- 022 only drained raw_bill)
--   election_candidates 14MB -> 1.8MB (5.8MB of FEC candidate blobs; ELECTION_CANDIDATE_SELECT
--                                      never lists the column)
--   politicians      8.7MB -> 5.6MB   } byte-identical copies of raw_member / raw_committee, which
--   committees       2.5MB -> 1.1MB   } is what every reader falls back through. The federal path
--   committee_members 2.4MB -> 0.8MB  } stopped writing the copy in 78c1f91; the state path did not.
--   database         672MB -> 417MB
--
-- Left alone deliberately:
--   * committee_members rows from source_system 'congress' keep their payload -- it is a synthesized
--     {committeeId, politicianId, role, matchedBy} provenance record, not a source blob, and
--     matchedBy is stored nowhere else.
--   * lobbying_filings (50MB) is real data -- 125,037 rows. pg_stat_user_tables reported it as
--     empty and never vacuumed, which is a stats artifact, not bloat; the ANALYZE at the bottom
--     fixes that. It had no planner statistics at all.
--   * bills_search_text_trgm_idx (22MB) is still at 0 lifetime scans, as it was in 022. Same call
--     as then -- the bill-directory search query can use it -- but it is now the largest object in
--     the database that has never been read. Worth revisiting.
--   * Both vote_positions indexes stay: the primary key has 298,661 lifetime scans and
--     politician_vote_idx 1,213. Neither is dead the way the two 018 dropped were.

-- ---------------------------------------------------------------------------
-- PART A -- transaction-safe, run as one script
-- ---------------------------------------------------------------------------

-- 230,489 rows carried a payload. Run in chunks: a single UPDATE over all of them has to maintain
-- both 64MB indexes in one statement and overruns the API statement timeout (a plain
-- `where raw_payload is not null` at 80k rows did). Repeat until it reports 0 rows.
update public.vote_positions set raw_payload = null
where ctid in (select ctid from public.vote_positions where raw_payload is not null limit 40000);

update public.bills set raw_payload = null where raw_payload is not null;
update public.election_candidates set raw_payload = null where raw_payload is not null;
update public.politicians set raw_payload = null where raw_payload is not null;
update public.committees set raw_payload = null where raw_payload is not null;
update public.committee_members set raw_payload = null
where raw_payload is not null and source_system <> 'congress';

-- ---------------------------------------------------------------------------
-- PART B -- one statement at a time, OUTSIDE a transaction ("ERROR: 25001")
-- ---------------------------------------------------------------------------
--
-- VACUUM FULL, not plain VACUUM. Unlike bills.raw_bill in 022 -- which lived in TOAST, so vacuuming
-- the TOAST table alone reclaimed it cheaply -- these payloads averaged 375 bytes, well under the
-- 2KB TOAST threshold, so they sat inline in the heap. vote_positions' TOAST table is 8KB, empty.
-- Only a heap rewrite returns inline space, and it takes an ACCESS EXCLUSIVE lock for the duration.
--
-- Headroom is fine here in a way it was not in 022: the database was at 586MB when this ran and
-- vote_positions' new copy is ~206MB, so the peak never approached the disk.

vacuum full public.committees;
vacuum full public.committee_members;
vacuum full public.politicians;
vacuum full public.election_candidates;
vacuum full public.bills;
vacuum full public.vote_positions;

analyze public.vote_positions;
-- Never analyzed since it was created in 017 -- no planner statistics at all.
analyze public.lobbying_filings;
