-- Extends the committee guard in 040 to every field a failed sync would blank. Already applied.
--
-- 040 kept member_ids and active_bill_ids. The same failure path also nulls the chair, ranking
-- member, description and contact details, and empties the subcommittee list, because
-- normalizeCommitteeRecord builds those from the detail response that failed to arrive.
--
-- Same rule throughout: a write that would replace a stored value with nothing keeps the stored
-- value; a write carrying real content still wins. Remove with 040 once the shared secret key is
-- rotated and only this repo's syncs can write.
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

  if (new.subcommittees is null or jsonb_array_length(coalesce(new.subcommittees, '[]'::jsonb)) = 0)
     and jsonb_array_length(coalesce(old.subcommittees, '[]'::jsonb)) > 0 then
    new.subcommittees := old.subcommittees;
  end if;

  new.chair := coalesce(nullif(btrim(coalesce(new.chair, '')), ''), old.chair);
  new.ranking_member := coalesce(nullif(btrim(coalesce(new.ranking_member, '')), ''), old.ranking_member);
  new.description := coalesce(nullif(btrim(coalesce(new.description, '')), ''), old.description);
  new.contact_url := coalesce(nullif(btrim(coalesce(new.contact_url, '')), ''), old.contact_url);
  new.contact_phone := coalesce(nullif(btrim(coalesce(new.contact_phone, '')), ''), old.contact_phone);
  new.contact_address := coalesce(nullif(btrim(coalesce(new.contact_address, '')), ''), old.contact_address);

  return new;
end;
$$;
