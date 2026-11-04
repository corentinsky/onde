-- Tests de sécurité : chacun ne voit que ce qu’il doit voir.
-- Lancés par run.mjs après stubs + migrations + seed. Toute assertion fausse lève une erreur.

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000001', 'regie@onde.test'),
  ('f0000000-0000-4000-8000-000000000002', 'siege@aubert.test'),
  ('f0000000-0000-4000-8000-000000000003', 'lyon@aubert.test'),
  ('f0000000-0000-4000-8000-000000000004', 'siege@verne.test'),
  ('f0000000-0000-4000-8000-000000000005', 'ara@aubert.test');
update public.profiles set is_platform_admin = true where id = 'f0000000-0000-4000-8000-000000000001';
insert into public.memberships (user_id, org_id, role, region_id, store_id) values
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'hq', null, null),
  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'store_manager', null, 'c0000000-0000-4000-8000-000000000002'),
  ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'hq', null, null),
  ('f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'regional', 'b0000000-0000-4000-8000-000000000002', null);

create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'ok : %', label;
end $$;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  execute 'set role authenticated';
end $$;

-- Régie : voit les deux enseignes.
select pg_temp.as_user('f0000000-0000-4000-8000-000000000001');
select pg_temp.check((select count(*) from public.organizations) = 2, 'la régie voit toutes les enseignes');
select pg_temp.check((select count(*) from public.stores) = 7, 'la régie voit toutes les boutiques');
reset role;

-- Siège Aubert : son enseigne seulement.
select pg_temp.as_user('f0000000-0000-4000-8000-000000000002');
select pg_temp.check((select count(*) from public.organizations) = 1, 'le siège ne voit que son enseigne');
select pg_temp.check((select count(*) from public.stores) = 6, 'le siège voit ses 6 boutiques');
select pg_temp.check((select count(*) from public.spots) = 5, 'le siège voit tous les spots de son enseigne');
select pg_temp.check((select count(*) from public.store_status) = 6, 'la supervision du siège couvre ses boutiques');
insert into public.spots (org_id, origin, title, duration_sec, status) values ('a0000000-0000-4000-8000-000000000001', 'national', 'Test siège', 10, 'draft') returning id;
select pg_temp.check(true, 'le siège peut créer un spot national et le relire aussitôt (returning)');
update public.organizations set hq_spots_enabled = false where id = 'a0000000-0000-4000-8000-000000000001';
select pg_temp.check((select not hq_spots_enabled from public.organizations), 'le siège peut suspendre ses spots nationaux');
reset role;
select pg_temp.check((select count(*) from public.audit_log where action = 'update' and target_type = 'organizations') = 1, 'la suspension est journalisée');

-- Siège Verne : ne voit rien d’Aubert.
select pg_temp.as_user('f0000000-0000-4000-8000-000000000004');
select pg_temp.check((select count(*) from public.stores) = 1, 'une autre enseigne ne voit pas les boutiques Aubert');
select pg_temp.check((select count(*) from public.spots) = 0, 'une autre enseigne ne voit pas les spots Aubert');
select pg_temp.check((select count(*) from public.play_logs) = 0, 'une autre enseigne ne voit pas les preuves Aubert');
do $$ begin
  begin
    insert into public.spots (org_id, origin, title, duration_sec) values ('a0000000-0000-4000-8000-000000000001', 'national', 'Intrusion', 10);
    raise exception 'ÉCHEC : une autre enseigne a pu créer un spot chez Aubert';
  exception when insufficient_privilege then raise notice 'ok : une autre enseigne ne peut pas écrire chez Aubert';
  end;
end $$;
reset role;

-- Responsable Lyon : sa boutique seulement.
select pg_temp.as_user('f0000000-0000-4000-8000-000000000003');
select pg_temp.check((select count(*) from public.stores) = 1, 'la boutique ne voit qu’elle-même');
select pg_temp.check((select count(*) from public.spots where origin = 'national') = 3, 'la boutique voit les spots nationaux');
select pg_temp.check((select count(*) from public.spots where origin = 'store') = 1, 'la boutique ne voit pas les messages des autres boutiques');
select pg_temp.check((select count(*) from public.incidents) = 0, 'la boutique ne voit pas les incidents des autres');
insert into public.spots (id, org_id, origin, title, duration_sec, status) values ('e0000000-0000-4000-8000-0000000000ff', 'a0000000-0000-4000-8000-000000000001', 'store', 'Ma promo', 10, 'pending_review') returning id;
select pg_temp.check(true, 'la boutique peut proposer un message et le relire aussitôt (returning)');
insert into public.spot_targets (spot_id, scope, store_id) values ('e0000000-0000-4000-8000-0000000000ff', 'store', 'c0000000-0000-4000-8000-000000000002');
select pg_temp.check(true, 'la boutique peut proposer un message pour elle-même');
do $$ begin
  begin
    insert into public.spots (org_id, origin, title, duration_sec, status) values ('a0000000-0000-4000-8000-000000000001', 'national', 'Je me fais siège', 10, 'approved');
    raise exception 'ÉCHEC : la boutique a pu créer un spot national';
  exception when insufficient_privilege then raise notice 'ok : la boutique ne peut pas créer de spot national';
  end;
  begin
    perform public.review_spot('e0000000-0000-4000-8000-0000000000ff', true);
    raise exception 'ÉCHEC : la boutique a pu valider son propre message';
  exception when insufficient_privilege then raise notice 'ok : la boutique ne peut pas valider son message';
  end;
end $$;
update public.spots set status = 'approved' where id = 'e0000000-0000-4000-8000-0000000000ff';
reset role;
select pg_temp.check((select status from public.spots where id = 'e0000000-0000-4000-8000-0000000000ff') = 'pending_review', 'la boutique ne peut pas s’auto-approuver par mise à jour');

-- Régional ARA : les boutiques de sa région.
select pg_temp.as_user('f0000000-0000-4000-8000-000000000005');
select pg_temp.check((select count(*) from public.stores) = 1, 'le régional voit les boutiques de sa région');
reset role;

-- Régie : valide le message de Lyon.
select pg_temp.as_user('f0000000-0000-4000-8000-000000000001');
select pg_temp.check((select status from public.review_spot('e0000000-0000-4000-8000-0000000000ff', true)) = 'approved', 'la régie valide un message boutique');
reset role;

-- Anonyme : rien.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.check((select count(*) from public.stores) = 0, 'un visiteur anonyme ne voit rien');
reset role;
