-- At most one `running` row per pipeline, so the lock in runPipeline holds across processes.
-- Already applied.
--
-- runPipeline's lock was a module-level Set: it only stopped overlap inside one server process.
-- Separate Vercel instances, and the Mac cron with the shared secret key, ran the same pipeline at
-- once, and each new run marked every other `running` row failed ("Superseded by a newer pipeline
-- run") whether or not it was still working. The orchestrator now supersedes only rows older than
-- the function timeout, and inserting a second live `running` row fails on this index, which the
-- orchestrator reports as skipped.
create unique index if not exists sync_runs_one_running_per_pipeline
  on public.sync_runs (pipeline)
  where status = 'running';
