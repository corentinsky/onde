-- Données de démonstration : enseignes fictives « Maison Aubert » et « Atelier Verne ».
-- Aucune donnée réelle. À ne charger qu’en local ou sur un projet de démo.

insert into public.organizations (id, name, slug) values
  ('a0000000-0000-4000-8000-000000000001', 'Maison Aubert', 'maison-aubert'),
  ('a0000000-0000-4000-8000-000000000002', 'Atelier Verne', 'atelier-verne');

insert into public.regions (id, org_id, name) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Île-de-France'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Auvergne-Rhône-Alpes'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Hauts-de-France'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Pays de la Loire'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'Nouvelle-Aquitaine'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'PACA'),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000002', 'Île-de-France');

insert into public.stores (id, org_id, region_id, code, name, city) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '0101', 'Paris Haussmann', 'Paris'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', '0412', 'Lyon Part-Dieu', 'Lyon'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004', '0731', 'Nantes Atlantis', 'Nantes'),
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', '0815', 'Bordeaux Sainte-Catherine', 'Bordeaux'),
  ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', '0207', 'Lille Euralille', 'Lille'),
  ('c0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000006', '0903', 'Marseille Prado', 'Marseille'),
  ('c0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000007', 'V001', 'Verne Marais', 'Paris');

update public.stores set opening_hours = '{"mon":["10:00","19:30"],"tue":["10:00","19:30"],"wed":["10:00","19:30"],"thu":["10:00","20:30"],"fri":["10:00","19:30"],"sat":["10:00","19:30"]}'::jsonb;

insert into public.ambiences (org_id, name, azuracast_station) values
  ('a0000000-0000-4000-8000-000000000001', 'Signature', 'aubert_signature'),
  ('a0000000-0000-4000-8000-000000000001', 'Soft', 'aubert_soft'),
  ('a0000000-0000-4000-8000-000000000001', 'Énergie', 'aubert_energie'),
  ('a0000000-0000-4000-8000-000000000002', 'Atelier', 'verne_atelier');

insert into public.devices (id, store_id, name, app_version, last_seen_at, now_playing, cache_seconds, output_lufs) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Onde Box', '0.1.0', now() - interval '20 seconds', '{"title":"Paper Boats","artist":"Anna Veil"}', 64800, -18.4),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'Onde Box', '0.1.0', now() - interval '12 seconds', '{"title":"Velvet Hours","artist":"Nuits Blanches"}', 66000, -19.0),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'Onde Box', '0.1.0', now() - interval '40 seconds', '{"title":"Slow Linen","artist":"Maren Aldo"}', 61200, -18.1),
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000004', 'Onde Box', '0.1.0', now() - interval '8 seconds', '{"title":"Glass City","artist":"Kora Nine"}', 70000, -9.2),
  ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005', 'Onde Box', '0.1.0', now() - interval '6 minutes', '{"title":"Late Light","artist":"The Corners"}', 54000, -18.6),
  ('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000006', 'Onde Box', '0.1.0', now() - interval '2 hours', null, 57600, null);

insert into public.spots (id, org_id, origin, title, script, duration_sec, mode, status, starts_on, ends_on, daily_start, daily_end, every_min) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'national', 'Carte cadeau de Noël', 'Offrez l’élégance : la carte cadeau Maison Aubert est disponible en caisse.', 14, 'next_break', 'approved', '2026-12-01', '2026-12-24', '11:00', '19:00', 90),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'national', 'Retouches offertes', 'Les retouches sont offertes sur tous les costumes jusqu’à dimanche.', 12, 'next_break', 'approved', '2026-11-01', '2026-11-30', '10:00', '19:30', 120);
insert into public.spots (id, org_id, origin, title, script, duration_sec, mode, status, starts_on, ends_on, fixed_times) values
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'national', 'Lancement des soldes', 'Les soldes d’hiver commencent aujourd’hui chez Maison Aubert.', 20, 'sync', 'approved', '2027-01-07', '2027-01-07', array['10:00'::time]);
insert into public.spots (id, org_id, origin, title, script, duration_sec, status) values
  ('e0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'store', 'Démarque -20 % sur les costumes', 'Dernière démarque ce week-end : moins 20 % sur les costumes.', 12, 'pending_review'),
  ('e0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'store', 'Nocturne jeudi', 'Votre boutique vous accueille jusqu’à 21 h ce jeudi.', 10, 'pending_review');

insert into public.spot_targets (spot_id, scope, region_id, store_id) values
  ('e0000000-0000-4000-8000-000000000001', 'all', null, null),
  ('e0000000-0000-4000-8000-000000000002', 'all', null, null),
  ('e0000000-0000-4000-8000-000000000003', 'all', null, null),
  ('e0000000-0000-4000-8000-000000000004', 'store', null, 'c0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000005', 'store', null, 'c0000000-0000-4000-8000-000000000001');

insert into public.play_logs (org_id, store_id, device_id, spot_id, scheduled_for, played_at, status, reason) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', now() - interval '30 minutes', now() - interval '29 minutes', 'played', null),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', now() - interval '2 hours', null, 'missed', 'window');

insert into public.incidents (org_id, store_id, device_id, kind, details, started_at) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000006', 'offline', 'Boutique hors ligne. Le lecteur joue sa musique en avance.', now() - interval '2 hours'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 'offline', 'Connexion instable, reconnexion en cours.', now() - interval '6 minutes'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 'volume', 'Le niveau dépasse de 9 dB le plafond fixé par le siège.', now() - interval '4 minutes');

-- Musique : une rotation par ambiance (créée par la migration en production) et une journée type.
insert into public.playlists (org_id, ambience_id, name)
select org_id, id, 'Rotation principale' from public.ambiences
where not exists (select 1 from public.playlists p where p.ambience_id = ambiences.id);

insert into public.dayparts (org_id, name, ambience_id, start_time, end_time, position)
select 'a0000000-0000-4000-8000-000000000001', d.name, a.id, d.s::time, d.e::time, d.pos
from (values ('Ouverture', 'Soft', '09:30', '11:00', 1), ('Matinée', 'Signature', '11:00', '13:00', 2),
             ('Déjeuner', 'Énergie', '13:00', '15:00', 3), ('Après-midi', 'Signature', '15:00', '17:30', 4),
             ('Fin de journée', 'Soft', '17:30', '21:00', 5)) as d(name, amb, s, e, pos)
join public.ambiences a on a.org_id = 'a0000000-0000-4000-8000-000000000001' and a.name = d.amb;
