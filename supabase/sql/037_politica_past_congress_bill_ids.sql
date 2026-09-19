-- Past-Congress bill stubs get their own ids. Already applied.
--
-- syncFederalMemberSponsoredBillHistory stores a member's bills from earlier Congresses as stub
-- rows so their career list is complete. It gave them the same id format as current bills --
-- "s-5614" for the 118th Congress's DRAIN THE SWAMP Act -- so each stub occupied the id the 119th
-- Congress's bill of that number needs, and lobbying reports citing the 119th bill were linked to
-- the 118th one (54 links on 2026-09-19). 991 stubs; none had actions, versions, votes, issue links
-- or search documents, so the only rows pointing at them were those mislinked lobbying mentions.
--
-- The stubs become "s-5614-118" (the sync now writes that format), the mislinked mentions are
-- dropped -- the next lobbying sync re-links them if the 119th bill is stored -- and the session
-- labels get proper ordinals ("102nd", not "102th"; see congressSessionLabel in lib/utils.ts).

delete from public.lobbying_bill_mentions m
using public.bills b
where b.id = m.bill_id and b.session <> '119th Congress';

update public.bills
set
  id = id || '-' || substring(session from '^(\d+)'),
  slug = id || '-' || substring(session from '^(\d+)'),
  session = regexp_replace(
    session,
    '^(\d+)th Congress$',
    '\1' || case
      when substring(session from '^(\d+)')::int % 100 between 11 and 13 then 'th'
      when substring(session from '^(\d+)')::int % 10 = 1 then 'st'
      when substring(session from '^(\d+)')::int % 10 = 2 then 'nd'
      when substring(session from '^(\d+)')::int % 10 = 3 then 'rd'
      else 'th'
    end || ' Congress'
  )
where session ~ '^\d+(st|nd|rd|th) Congress$'
  and session <> '119th Congress'
  and id !~ '-\d+-\d+$';
