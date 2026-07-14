-- Allow a roll call to exist without the bill it belongs to.
--
-- votes.bill_id was `not null references bills(id)`, which made a vote a child of a bill. State
-- roll calls come from OpenStates, whose bill corpus we do not fully import, so every state vote
-- was unstorable -- and with no stored votes there are no vote_positions, which is why every
-- state legislator has zero attendance and zero party alignment.
--
-- A roll call is an event in its own right: a member's attendance does not depend on whether we
-- happened to import the bill they were voting on. Dropping NOT NULL (keeping the FK, so a
-- populated bill_id still has to be real) lets votes stand alone.

alter table public.votes
  alter column bill_id drop not null;

-- Attendance queries scan a member's positions; keep that keyed.
create index if not exists vote_positions_politician_vote_idx
  on public.vote_positions (politician_id, vote_id);

-- Roll calls that are not attached to a bill are still listed per chamber and date.
create index if not exists votes_chamber_voted_on_idx
  on public.votes (chamber, voted_on desc nulls last);

analyze public.votes;
analyze public.vote_positions;
