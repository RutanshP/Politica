-- Track whether a stored member is currently serving.
--
-- The federal roster sync (federal_members_sync) upserts current members from
-- Congress.gov but never removed departed ones, so people who left office (e.g.
-- a senator who died mid-term) lingered in the directory as "current", and a
-- separate vote-import pipeline (federal_votes) added skeletal placeholder rows.
-- This flag lets the sync retire members Congress.gov no longer reports as
-- current while preserving their vote history; the directory filters on it.

alter table politicians
  add column if not exists is_current boolean not null default true;

comment on column politicians.is_current is
  'False marks a member who has left office (Congress.gov currentMember=false, or a departed vote-only record). Departed members are kept for historical vote history but excluded from the current directory.';

-- Departed members are the small minority; index only those for cheap filtering.
create index if not exists idx_politicians_is_current on politicians (is_current) where is_current = false;
