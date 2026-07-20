-- Re-tier the funding graph for already-synced members.
--
-- The normalizer now routes employer aggregates and small-dollar giving through
-- the per-politician "Individual donors" hub (tier 1 -> tier 2 -> committee)
-- instead of every source pointing straight at the committee, so the graph is a
-- real multi-tier network. New syncs emit the tiered topology directly; this
-- one-time backfill retargets the edges already stored (avoids a full FEC
-- re-sync). Idempotent: once an edge points at the hub it no longer matches the
-- committee-join below.

-- Employer aggregates -> the individual-donors hub feeding the same committee.
update graph_edges e
set target_entity_id = ind.source_entity_id
from graph_edges ind
where e.relationship_type = 'employee_contributions'
  and e.source_system = 'fec_sync'
  and ind.relationship_type = 'contributed_to'
  and ind.source_entity_id like 'fec-ind-%'
  and ind.target_entity_id = e.target_entity_id
  and ind.source_entity_id <> e.target_entity_id;

-- Small-dollar (a subset of individual giving) -> the same hub.
update graph_edges e
set target_entity_id = ind.source_entity_id
from graph_edges ind
where e.source_entity_id like 'fec-small-%'
  and e.source_system = 'fec_sync'
  and ind.relationship_type = 'contributed_to'
  and ind.source_entity_id like 'fec-ind-%'
  and ind.target_entity_id = e.target_entity_id
  and ind.source_entity_id <> e.target_entity_id;
