-- A committee's roster and bill list can never be replaced with nothing. Already applied.
--
-- The committee sync used to write a committee back empty whenever its detail fetch failed. That
-- is fixed in the app (see legislation-sync.ts), but the fix only protects callers running current
-- code: on 2026-09-20 at 17:16 UTC a job outside this repo -- running an older build against the
-- same Supabase key -- emptied the same seven Senate committees again, hours after they were
-- restored. Commerce, Judiciary, Energy, Environment, Rules, Veterans' Affairs and Small Business
-- lost every member and every referred bill, for the second time in two days.
--
-- A trigger is the only guard that holds regardless of which build is writing. An update that
-- would blank member_ids or active_bill_ids keeps the stored value instead; a real roster change
-- (a non-empty list) still writes normally. listStoredCommittees falls back to committees.member_ids
-- when committee_members has no rows, so this keeps the member list on the page too.
--
-- Remove it once the shared secret key has been rotated and nothing but this repo's syncs can write.
create or replace function public.committees_keep_non_empty()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.member_ids is null or jsonb_array_length(coalesce(new.member_ids, '[]'::jsonb)) = 0)
     and jsonb_array_length(coalesce(old.member_ids, '[]'::jsonb)) > 0 then
    new.member_ids := old.member_ids;
  end if;

  if (new.active_bill_ids is null or jsonb_array_length(coalesce(new.active_bill_ids, '[]'::jsonb)) = 0)
     and jsonb_array_length(coalesce(old.active_bill_ids, '[]'::jsonb)) > 0 then
    new.active_bill_ids := old.active_bill_ids;
  end if;

  return new;
end;
$$;

drop trigger if exists committees_keep_non_empty_trg on public.committees;
create trigger committees_keep_non_empty_trg
  before update on public.committees
  for each row
  execute function public.committees_keep_non_empty();
