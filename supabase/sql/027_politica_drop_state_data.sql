-- Deletes all state legislature data. Already applied; kept here as the record.
-- Database 417MB -> 273MB. Restoring any of it means re-running the OpenStates syncs.
--
-- The app covers Congress only for now, and state coverage was over half the database:
--
--   vote_positions   260,564 of 618,199   (42%)
--   votes              7,534 of   8,978   (84%)
--   politicians        1,668 of   2,223   (75%)
--   committees           419 of     655   (64%)
--   bills                128 of  19,146
--
-- Every state row was cleanly tagged -- all state politicians and votes carry
-- source_system='openstates' -- so nothing had to be identified by heuristic. Two details did
-- matter:
--
-- 1. 395 openstates votes have jurisdiction_type NULL rather than 'state', so votes are keyed on
--    source_system. Filtering on jurisdiction_type would have stranded them and their positions.
--
-- 2. election_candidates.politician_id is the one FK to politicians that does NOT cascade
--    (NO ACTION). It references federal incumbents only, so the delete was clear -- verified as 0
--    matches before running rather than assumed.
--
-- Everything else cascades: bills -> bill_actions/bill_versions/issue_bill_links/votes,
-- votes -> vote_positions, politicians -> committee_members/vote_positions/
-- candidate_finance_snapshots, committees -> committee_members.
--
-- The derived tables needed care. search_documents.entity_id and entities.id hold the *slug* for
-- politicians and committees ('adam-b-schiff'), not the id ('S001150'). An anti-join on id looked
-- like it had found 2,205 orphaned politician documents -- every federal one included -- and would
-- have emptied search. Joining on slug gives the true figures: 128 bills, 1,668 politicians,
-- 419 committees, matching the deletions exactly.
--
-- The syncs are gated, not deleted (lib/server/internal-api.ts). One authenticated call to
-- /api/internal/sync/state-votes would restore ~130MB, and that route was never on a schedule, so
-- the risk is a manual run. POLITICA_ENABLE_STATE_SYNC=1 turns it back on; a test asserts both
-- routes still check the gate and that neither scheduler references them.

-- ---------------------------------------------------------------------------
-- PART A -- transaction-safe
-- ---------------------------------------------------------------------------

-- Chunked: 260k rows cascading from the votes delete overruns the statement timeout in one go.
-- Repeat until it reports 0.
delete from public.vote_positions
where ctid in (select ctid from public.vote_positions where source_system = 'openstates' limit 100000);

delete from public.votes where source_system = 'openstates';

delete from public.bills where jurisdiction_type = 'state';
delete from public.committees where jurisdiction_type = 'state';
delete from public.politicians where jurisdiction_type = 'state';

-- Derived rows. Note the slug joins for politicians and committees.
delete from public.search_documents where entity_type = 'bill'       and entity_id not in (select id   from public.bills);
delete from public.search_documents where entity_type = 'politician' and entity_id not in (select slug from public.politicians);
delete from public.search_documents where entity_type = 'committee'  and entity_id not in (select slug from public.committees);
delete from public.entities         where entity_type = 'bill'       and id not in (select id   from public.bills);
delete from public.entities         where entity_type = 'politician' and id not in (select slug from public.politicians);
delete from public.entities         where entity_type = 'committee'  and id not in (select slug from public.committees);

delete from public.entity_relationships
where source_entity_id not in (select id from public.entities)
   or target_entity_id not in (select id from public.entities);

-- ---------------------------------------------------------------------------
-- PART B -- one statement at a time, OUTSIDE a transaction ("ERROR: 25001")
-- ---------------------------------------------------------------------------
vacuum full public.vote_positions;   -- 206MB -> 78MB
vacuum full public.votes;
vacuum full public.politicians;
vacuum full public.committees;
vacuum full public.search_documents;
vacuum full public.entities;
vacuum full public.entity_relationships;
vacuum full public.bills;

analyze public.vote_positions;
analyze public.votes;

-- Largest tables afterwards: vote_positions 78MB, lobbying_filings 56MB, bills 42MB.
-- lobbying_filings is now the second largest object and its three indexes have ~0 lifetime scans;
-- worth a look next if the database needs to get smaller still.
