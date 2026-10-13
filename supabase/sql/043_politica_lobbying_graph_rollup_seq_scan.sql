-- Keeps lobbying_graph_rollup_json on a sequential scan. Already applied.
--
-- The weekly lobbying graph rebuild failed on 2026-09-19, 09-27 and 10-04 with 57014 (statement
-- timeout, PostgREST's 8s). It runs on Sundays right after /api/internal/rebuild, with the cache
-- cold, and for that grouping the planner prefers an index scan over lobbying_filings_supersede_idx
-- (sorted input, so no hash spill). That walks the heap in index order: ~157k buffer touches for a
-- table of ~5k pages, which is ~0.6s warm and over 6s cold. A sequential scan plus a hash aggregate
-- touches ~5.6k buffers and runs in ~0.35s either way.
--
-- The function reads every current filing regardless of p_years in practice, so no index ever
-- helps it. work_mem is raised so the ~32k groups hash in memory instead of spilling to disk.
alter function public.lobbying_graph_rollup_json(integer[])
  set enable_indexscan = off;
alter function public.lobbying_graph_rollup_json(integer[])
  set enable_bitmapscan = off;
alter function public.lobbying_graph_rollup_json(integer[])
  set work_mem = '16MB';
