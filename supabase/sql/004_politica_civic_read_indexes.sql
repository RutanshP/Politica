create index if not exists bills_jurisdiction_type_session_idx
  on public.bills (jurisdiction_type, session);

create index if not exists bills_source_system_session_idx
  on public.bills (source_system, session);

create index if not exists bills_jurisdiction_type_synced_at_idx
  on public.bills (jurisdiction_type, synced_at desc);

create index if not exists bill_actions_bill_id_sort_order_idx
  on public.bill_actions (bill_id, sort_order);

create index if not exists bill_versions_bill_id_sort_order_idx
  on public.bill_versions (bill_id, sort_order);

create index if not exists votes_bill_id_date_label_idx
  on public.votes (bill_id, date_label desc);

create index if not exists vote_positions_vote_id_name_idx
  on public.vote_positions (vote_id, name);

create index if not exists committee_members_committee_sort_idx
  on public.committee_members (committee_id, sort_order);

create index if not exists committee_members_politician_sort_idx
  on public.committee_members (politician_id, sort_order);

create index if not exists politicians_jurisdiction_type_name_idx
  on public.politicians (jurisdiction_type, name);
