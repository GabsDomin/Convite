import fs from "node:fs";

const head = `-- RSVP: Família (titular) + Parceiro(a) / Filho(a) nos acompanhantes

alter table public.rsvps drop constraint if exists rsvps_party_size_check;

alter table public.rsvps add constraint rsvps_party_size_check
  check (party_size in (
    'Somente eu',
    'Casal',
    'Família',
    'Responsável e menores',
    'Acompanhante',
    'Parceiro(a)',
    'Filho(a)'
  ));

`;
const fn = fs.readFileSync("supabase-rsvp-per-guest-functions-only.sql", "utf8");
const tail = `
-- dados legados
update public.rsvps set party_size = 'Família' where id = 'f6a4d999-942f-4e10-96fb-df1fbc03f9c3';
update public.rsvps set party_size = 'Parceiro(a)' where id = '85bf8e6c-39d4-4887-aad2-e591fa57810f';
update public.rsvps set party_size = 'Filho(a)' where id in (
  '9e1582a6-e581-490e-b1f9-9521d3d175e3',
  'af394b25-c792-4f97-88c9-77b9a60f89b8'
);
update public.rsvps companion set party_size = 'Parceiro(a)'
where companion.party_size = 'Acompanhante'
  and companion.primary_rsvp_id in (
    select p.id from public.rsvps p
    where p.primary_rsvp_id is null and p.party_size = 'Casal'
      and (select count(*) from public.rsvps c where c.primary_rsvp_id = p.id) = 1
  );
`;
const full = head + fn + tail;
fs.writeFileSync("supabase-rsvp-familia-party-size.sql", full);
console.log("bytes", full.length);
