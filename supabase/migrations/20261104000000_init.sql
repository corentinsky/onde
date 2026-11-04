-- Onde — schéma initial.
-- Une "organisation" = une société cliente (enseigne). La régie (équipe Onde)
-- est "platform admin" et voit tout. Chaque membre d’une organisation ne voit
-- que son organisation, et selon son rôle, sa région ou sa boutique.

create extension if not exists pgcrypto;

-- ───────────────────────── Types ─────────────────────────
create type public.member_role as enum ('hq', 'regional', 'store_manager');
create type public.spot_origin as enum ('emergency', 'national', 'regional', 'store');
create type public.spot_mode as enum ('next_break', 'sync');
create type public.spot_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'paused', 'archived');
create type public.target_scope as enum ('all', 'region', 'store');
create type public.play_status as enum ('played', 'partial', 'missed', 'skipped');
create type public.incident_kind as enum ('offline', 'silence', 'volume', 'stuck', 'cache_low', 'spot_missed');

-- ───────────────────────── Tables ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  hq_spots_enabled boolean not null default true,
  emergency jsonb,                          -- { kind, text, started_at, started_by } quand une urgence est en cours
  created_at timestamptz not null default now()
);

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  unique (org_id, name)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  region_id uuid references public.regions (id) on delete set null,
  code text not null,
  name text not null,
  city text not null default '',
  timezone text not null default 'Europe/Paris',
  opening_hours jsonb not null default '{}'::jsonb,   -- { "mon": ["10:00","19:30"], ... }
  max_volume smallint not null default 80 check (max_volume between 0 and 100),
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role public.member_role not null,
  region_id uuid references public.regions (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id),
  check (role <> 'regional' or region_id is not null),
  check (role <> 'store_manager' or store_id is not null)
);

create table public.ambiences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  azuracast_station text,                   -- nom court de la station AzuraCast
  stream_url text,
  unique (org_id, name)
);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  ambience_id uuid references public.ambiences (id) on delete set null,
  volume smallint not null default 60 check (volume between 0 and 100),
  messages_enabled boolean not null default true,
  jingles_enabled boolean not null default true
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null default 'Lecteur',
  pairing_code text unique,                 -- code court affiché à l’installation, effacé une fois appairé
  token_hash text unique,                   -- sha256 du jeton du lecteur ; le jeton lui-même n’est jamais stocké
  app_version text,
  last_seen_at timestamptz,
  now_playing jsonb,                        -- { title, artist, ends_at }
  cache_seconds integer,
  output_lufs numeric(5,1),
  created_at timestamptz not null default now()
);

create table public.broadcast_rules (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  priority public.spot_origin[] not null default array['national','regional','store']::public.spot_origin[],
  max_per_break smallint not null default 3 check (max_per_break between 1 and 10),
  max_seconds_per_hour integer not null default 240 check (max_seconds_per_hour between 0 and 3600),
  min_gap_same_spot_min smallint not null default 20 check (min_gap_same_spot_min between 0 and 240),
  window_min smallint not null default 20 check (window_min between 1 and 120),
  never_cut_track boolean not null default true,
  duck_music boolean not null default true,
  alert_on_miss boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  origin public.spot_origin not null,
  title text not null,
  script text not null default '',
  audio_path text,                          -- chemin dans le stockage Supabase "spots"
  duration_sec integer not null default 15 check (duration_sec between 1 and 600),
  mode public.spot_mode not null default 'next_break',
  status public.spot_status not null default 'draft',
  starts_on date,
  ends_on date,
  daily_start time not null default '10:00',
  daily_end time not null default '19:00',
  every_min integer check (every_min is null or every_min >= 15),
  fixed_times time[],
  window_min smallint,
  created_by uuid references auth.users (id) default auth.uid(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (every_min is not null or fixed_times is not null or status in ('draft','pending_review','rejected'))
);

create table public.spot_targets (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  scope public.target_scope not null,
  region_id uuid references public.regions (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  check ((scope = 'all' and region_id is null and store_id is null)
      or (scope = 'region' and region_id is not null and store_id is null)
      or (scope = 'store' and store_id is not null and region_id is null))
);

create table public.play_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  spot_id uuid references public.spots (id) on delete set null,
  scheduled_for timestamptz,
  played_at timestamptz,
  status public.play_status not null,
  reason text,
  created_at timestamptz not null default now()
);
create index play_logs_store_time on public.play_logs (store_id, created_at desc);
create index play_logs_spot on public.play_logs (spot_id, created_at desc);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  kind public.incident_kind not null,
  details text not null default '',
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_store_at timestamptz
);
create index incidents_open on public.incidents (org_id) where resolved_at is null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id),
  action text not null,
  target_type text not null,
  target_id text,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

-- ───────────────────────── Fonctions d’accès ─────────────────────────
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.member_role_in(p_org uuid) returns public.member_role
language sql stable security definer set search_path = public as $$
  select role from public.memberships where user_id = auth.uid() and org_id = p_org
$$;

create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (select 1 from public.memberships where user_id = auth.uid() and org_id = p_org)
$$;

-- Siège ou régie : pilote toute l’organisation.
create or replace function public.is_org_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or public.member_role_in(p_org) = 'hq'
$$;

-- Peut voir une boutique : régie, siège, régional de sa région, responsable de sa boutique.
create or replace function public.can_see_store(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from public.stores s
    join public.memberships m on m.org_id = s.org_id and m.user_id = auth.uid()
    where s.id = p_store
      and (m.role = 'hq'
        or (m.role = 'regional' and m.region_id = s.region_id)
        or (m.role = 'store_manager' and m.store_id = s.id))
  )
$$;

-- ───────────────────────── Sécurité par ligne ─────────────────────────
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.regions enable row level security;
alter table public.stores enable row level security;
alter table public.memberships enable row level security;
alter table public.ambiences enable row level security;
alter table public.zones enable row level security;
alter table public.devices enable row level security;
alter table public.broadcast_rules enable row level security;
alter table public.spots enable row level security;
alter table public.spot_targets enable row level security;
alter table public.play_logs enable row level security;
alter table public.incidents enable row level security;
alter table public.audit_log enable row level security;

create policy "profil : soi-même ou régie" on public.profiles for select using (id = auth.uid() or public.is_platform_admin());
create policy "profil : modifier son nom" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and is_platform_admin = public.is_platform_admin());

create policy "orga : lecture membres" on public.organizations for select using (public.is_member(id));
create policy "orga : création régie" on public.organizations for insert with check (public.is_platform_admin());
create policy "orga : pilotage siège" on public.organizations for update using (public.is_org_manager(id)) with check (public.is_org_manager(id));

create policy "régions : lecture" on public.regions for select using (public.is_member(org_id));
create policy "régions : gestion" on public.regions for all using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

create policy "boutiques : lecture" on public.stores for select using (public.can_see_store(id));
create policy "boutiques : gestion" on public.stores for all using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

create policy "membres : lecture" on public.memberships for select using (user_id = auth.uid() or public.is_org_manager(org_id));
create policy "membres : gestion régie" on public.memberships for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "ambiances : lecture" on public.ambiences for select using (public.is_member(org_id));
create policy "ambiances : gestion régie" on public.ambiences for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "zones : lecture" on public.zones for select using (public.can_see_store(store_id));
create policy "zones : gestion régie" on public.zones for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Les lecteurs ne passent jamais par ici : ils parlent à l’API avec leur jeton.
create policy "lecteurs : lecture" on public.devices for select using (public.can_see_store(store_id));
create policy "lecteurs : gestion régie" on public.devices for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "règles : lecture" on public.broadcast_rules for select using (public.is_member(org_id));
create policy "règles : gestion régie" on public.broadcast_rules for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.can_see_spot(p_spot uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.spots sp
    where sp.id = p_spot and (
      public.is_org_manager(sp.org_id)
      or sp.created_by = auth.uid()
      or exists (select 1 from public.spot_targets t where t.spot_id = sp.id and (
           (t.scope = 'all' and public.is_member(sp.org_id))
        or (t.scope = 'region' and exists (select 1 from public.stores s where s.region_id = t.region_id and public.can_see_store(s.id)))
        or (t.scope = 'store' and public.can_see_store(t.store_id))))))
$$;

create policy "spots : lecture" on public.spots for select using (public.can_see_spot(id));
-- Le siège crée des spots nationaux ou régionaux ; les boutiques proposent, la régie valide.
create policy "spots : création siège" on public.spots for insert with check (
  public.is_org_manager(org_id) and origin in ('national', 'regional', 'emergency')
);
create policy "spots : proposition boutique" on public.spots for insert with check (
  origin = 'store' and status = 'pending_review' and public.member_role_in(org_id) = 'store_manager'
);
create policy "spots : modification siège" on public.spots for update using (
  public.is_org_manager(org_id) and (origin <> 'store' or public.is_platform_admin())
) with check (public.is_org_manager(org_id));

create policy "cibles : lecture" on public.spot_targets for select using (public.can_see_spot(spot_id));
create policy "cibles : gestion siège" on public.spot_targets for all using (
  exists (select 1 from public.spots s where s.id = spot_id and public.is_org_manager(s.org_id))
) with check (
  exists (select 1 from public.spots s where s.id = spot_id and public.is_org_manager(s.org_id))
);
create policy "cibles : boutique sur sa boutique" on public.spot_targets for insert with check (
  scope = 'store' and exists (
    select 1 from public.spots s join public.memberships m on m.org_id = s.org_id and m.user_id = auth.uid()
    where s.id = spot_id and s.created_by = auth.uid() and m.role = 'store_manager' and m.store_id = spot_targets.store_id)
);

create policy "preuves : lecture" on public.play_logs for select using (public.can_see_store(store_id));
create policy "incidents : lecture" on public.incidents for select using (public.can_see_store(store_id));
create policy "incidents : traitement" on public.incidents for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));
create policy "journal : lecture" on public.audit_log for select using (public.is_platform_admin() or (org_id is not null and public.is_org_manager(org_id)));

-- ───────────────────────── Automatismes ─────────────────────────
-- Profil créé à l’inscription.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Règles par défaut pour chaque nouvelle organisation.
create or replace function public.handle_new_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.broadcast_rules (org_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_org_created after insert on public.organizations for each row execute function public.handle_new_org();

-- Journal : qui a fait quoi sur les spots, les règles et le pilotage réseau.
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id text; v_row jsonb;
begin
  v_row := to_jsonb(coalesce(new, old));
  v_org := coalesce((v_row ->> 'org_id')::uuid, case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end);
  v_id := coalesce(v_row ->> 'id', v_row ->> 'org_id');
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, data)
  values (v_org, auth.uid(), lower(tg_op), tg_table_name, v_id,
          case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else v_row end);
  return coalesce(new, old);
end $$;
create trigger audit_spots after insert or update or delete on public.spots for each row execute function public.audit();
create trigger audit_rules after update on public.broadcast_rules for each row execute function public.audit();
create trigger audit_orgs after update of hq_spots_enabled, emergency on public.organizations for each row execute function public.audit();

-- Validation d’un message boutique par la régie.
create or replace function public.review_spot(p_spot uuid, p_approve boolean) returns public.spots
language plpgsql security definer set search_path = public as $$
declare v public.spots;
begin
  if not public.is_platform_admin() then raise exception 'Réservé à la régie' using errcode = '42501'; end if;
  update public.spots
     set status = case when p_approve then 'approved' else 'rejected' end::public.spot_status,
         reviewed_by = auth.uid(), reviewed_at = now(),
         fixed_times = coalesce(fixed_times, case when p_approve and every_min is null then array[(now() at time zone 'Europe/Paris')::time] end)
   where id = p_spot and status = 'pending_review'
  returning * into v;
  if v.id is null then raise exception 'Spot introuvable ou déjà traité'; end if;
  return v;
end $$;

-- Vue de supervision : état de chaque boutique en un coup d’œil.
create or replace view public.store_status with (security_invoker = true) as
select s.id as store_id, s.org_id, s.name, s.city, s.region_id,
       d.id as device_id, d.last_seen_at, d.now_playing, d.cache_seconds, d.output_lufs, d.app_version,
       case
         when d.id is null then 'no_device'
         when d.last_seen_at is null or d.last_seen_at < now() - interval '5 minutes' then 'offline'
         when d.output_lufs is not null and d.output_lufs < -50 then 'silent'
         else 'online'
       end as status,
       (select count(*) from public.incidents i where i.store_id = s.id and i.resolved_at is null) as open_incidents
from public.stores s
left join lateral (select * from public.devices d where d.store_id = s.id order by d.last_seen_at desc nulls last limit 1) d on true;

-- Stockage des fichiers audio des spots (bucket privé).
insert into storage.buckets (id, name, public) values ('spots', 'spots', false) on conflict do nothing;
