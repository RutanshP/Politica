-- Database storage reclaim.
--
-- Two sources of dead weight, measured rather than guessed:
--
-- 1. vote_positions carried 88MB of indexes against 94MB of heap. `vote_id_name_idx`
--    (vote_id, name) was 26MB and had been used 40 times, while the primary key already leads
--    with vote_id; `politician_id_idx` duplicated the leading column of the composite
--    (politician_id, vote_id) index, which serves the same lookups.
--
-- 2. votes.raw_payload held 26MB of source documents -- 12KB per House roll call. Nothing reads
--    it: the only consumer is `rawAvailable: Boolean(row.raw_payload)`, a badge. Everything of
--    substance is already extracted into columns and into vote_positions, and the jurisdiction
--    backfill that once needed the raw organization id now has state_code persisted.
--
-- bill_versions.content was also a suspect but measured at 189kB, so it is left alone.
drop index if exists public.vote_positions_vote_id_name_idx;
drop index if exists public.vote_positions_politician_id_idx;

update public.votes set raw_payload = null where raw_payload is not null;

-- Reclaims the space rather than leaving it as free pages inside the table.
vacuum full public.votes;
vacuum analyze public.vote_positions;
