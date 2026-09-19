-- Storage reclaim, fourth pass. The database had grown from 273MB (after 027) to 468MB of the
-- 500MB ceiling by 2026-09-18.
--
-- 1. bills.raw_bill / bills.raw_payload came back: 17,511 bills, ~38MB of TOAST plus the heap
--    churn under it -- bills went 42MB -> 112MB. Current code has written null to both since
--    f708149 (2026-07-30), so this was not the app. It was scripts/detail-federal-bills.sh, a
--    macOS crontab job (every 2h) that runs `mode=full` against `next start` and only rebuilds when
--    `.next` is *missing* -- so it has been serving a build from before the fix. It walks all
--    ~17.9k bills and wraps to 0, re-writing every blob every couple of days. Nulling alone would
--    regrow within 48 hours, so a trigger now strips both columns on every write, whatever build
--    the client runs. The columns stay (old builds still send them; dropping them would 400 those
--    upserts), they just can never hold anything.
--
-- 2. entities (26MB) was a second copy of search_documents: same 19,540 rows, same label/title/
--    description/href. Its only reader was /entities/[entityId], which nothing links to; that page
--    now reads search_documents. The entity rebuild is removed.
--
-- 3. entity_relationships (30MB) was written by that rebuild and read by nothing. 46,544 of its
--    46,545 rows were `related-bill` edges -- a copy of bills.related_bill_ids.
--
-- Left alone deliberately:
--   * lobbying_filings (56MB): raw LDA staging behind the funding graph, of which only ~807
--     registrant/client pairs reach the graph. Whether to keep the raw filings depends on the graph
--     redesign -- not decided here.
--   * bills_search_text_trgm_idx (14MB, 0 scans): bill-directory search filters on
--     `search_text ilike` and can use it; there has just been no traffic.
--   * vote_positions (110MB): no duplicates (~432 per House roll call, ~100 per Senate). It grew
--     with real roll calls.

-- ---------------------------------------------------------------------------
-- PART A -- transaction-safe
-- ---------------------------------------------------------------------------

create or replace function public.bills_strip_raw_blobs()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.raw_bill := null;
  new.raw_payload := null;
  return new;
end;
$$;

drop trigger if exists bills_strip_raw_blobs on public.bills;
create trigger bills_strip_raw_blobs
  before insert or update on public.bills
  for each row execute function public.bills_strip_raw_blobs();

truncate table public.entity_relationships, public.entities;

update public.bills set raw_bill = null, raw_payload = null
where raw_bill is not null or raw_payload is not null;

-- ---------------------------------------------------------------------------
-- PART B -- one statement at a time, OUTSIDE a transaction ("ERROR: 25001")
-- ---------------------------------------------------------------------------

vacuum full public.bills;
vacuum full public.vote_positions;   -- ~43k dead tuples from the nightly vote refresh
analyze public.bills;
analyze public.vote_positions;
