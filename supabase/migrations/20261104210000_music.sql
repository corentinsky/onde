-- Onde — programmation musicale (équivalent AzuraCast, sans le direct).
-- Bibliothèque commune à toutes les enseignes (gérée par la régie), ambiances = « stations »,
-- listes de lecture avec types, poids, ordre, horaires, et historique des titres joués.

create type public.playlist_type as enum ('standard', 'once_per_songs', 'once_per_minutes', 'once_per_hour');
create type public.playlist_order as enum ('shuffle', 'random', 'sequential');
create type public.crossfade_mode as enum ('smart', 'normal', 'none');

-- ───────────── Bibliothèque commune ─────────────
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,          -- objet dans le stockage « music »
  file_name text not null,
  title text not null default '',
  artist text not null default '',
  album text not null default '',
  genre text not null default '',
  isrc text,
  year smallint,
  duration_sec numeric(8,2) not null check (duration_sec > 0),
  sample_rate integer,
  channels smallint,
  -- Traitement du son (EBU R128 / BS.1770-4)
  integrated_lufs numeric(5,1),
  loudness_range_lu numeric(5,1),
  peak_dbfs numeric(5,1),
  -- Points de mix (secondes depuis le début du fichier)
  cue_in numeric(8,2) not null default 0,
  cue_out numeric(8,2) not null,
  cross_start numeric(8,2) not null,
  fade_in numeric(6,2) not null default 0.1,
  fade_out numeric(6,2) not null default 0,
  manual_cues boolean not null default false,  -- vrai si réglés à la main : une nouvelle analyse ne les écrase pas
  waveform jsonb not null default '[]'::jsonb,
  warnings text[] not null default '{}',
  analysis_version smallint not null default 1,
  enabled boolean not null default true,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (cue_in >= 0 and cue_in < cue_out and cue_out <= duration_sec + 0.05),
  check (cross_start >= cue_in and cross_start <= cue_out),
  check (fade_in >= 0 and fade_out >= 0)
);
create index tracks_search on public.tracks (lower(artist), lower(title));

-- ───────────── Réglages audio de chaque ambiance (comme une station AzuraCast) ─────────────
alter table public.ambiences
  add column crossfade_mode public.crossfade_mode not null default 'smart',
  add column crossfade_sec numeric(4,1) not null default 2 check (crossfade_sec between 0 and 15),
  add column target_lufs numeric(4,1) not null default -18 check (target_lufs between -30 and -10),
  add column title_separation_min integer not null default 240 check (title_separation_min between 0 and 1440),
  add column artist_separation_min integer not null default 90 check (artist_separation_min between 0 and 1440);

-- ───────────── Listes de lecture ─────────────
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  ambience_id uuid not null references public.ambiences (id) on delete cascade,
  name text not null,
  type public.playlist_type not null default 'standard',
  weight smallint not null default 5 check (weight between 1 and 25),
  play_order public.playlist_order not null default 'shuffle',
  every_songs smallint check (every_songs >= 1),
  every_minutes smallint check (every_minutes >= 1),
  minute_of_hour smallint check (minute_of_hour between 0 and 59),
  start_time time,
  end_time time,
  days smallint[],                             -- 1 = lundi … 7 = dimanche
  start_date date,
  end_date date,
  avoid_duplicates boolean not null default true,
  is_jingle boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check (type <> 'once_per_songs' or every_songs is not null),
  check (type <> 'once_per_minutes' or every_minutes is not null),
  check (type <> 'once_per_hour' or minute_of_hour is not null),
  check (start_date is null or end_date is null or start_date <= end_date)
);
create index playlists_ambience on public.playlists (ambience_id);

create table public.playlist_tracks (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  position integer not null default 0,
  primary key (playlist_id, track_id)
);

-- ───────────── Journée type : ambiance selon l’heure ─────────────
create table public.dayparts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  ambience_id uuid not null references public.ambiences (id) on delete cascade,
  start_time time not null,
  end_time time not null,
  days smallint[],
  position smallint not null default 0
);

-- ───────────── Historique des titres joués (rapport de droits) ─────────────
create table public.track_plays (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  track_id uuid references public.tracks (id) on delete set null,
  playlist_id uuid references public.playlists (id) on delete set null,
  title text not null default '',
  artist text not null default '',
  isrc text,
  played_at timestamptz not null,
  duration_sec numeric(8,2),
  created_at timestamptz not null default now()
);
create index track_plays_org_time on public.track_plays (org_id, played_at desc);
create index track_plays_store_time on public.track_plays (store_id, played_at desc);

-- ───────────── Sécurité ─────────────
alter table public.tracks enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.dayparts enable row level security;
alter table public.track_plays enable row level security;

create or replace function public.has_any_membership() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (select 1 from public.memberships where user_id = auth.uid())
$$;

create policy "bibliothèque : lecture" on public.tracks for select using (public.has_any_membership());
create policy "bibliothèque : gestion régie" on public.tracks for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "listes : lecture" on public.playlists for select using (public.is_member(org_id));
create policy "listes : gestion régie" on public.playlists for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "contenu des listes : lecture" on public.playlist_tracks for select using (
  exists (select 1 from public.playlists p where p.id = playlist_id)
);
create policy "contenu des listes : gestion régie" on public.playlist_tracks for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "journée type : lecture" on public.dayparts for select using (public.is_member(org_id));
create policy "journée type : gestion régie" on public.dayparts for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "titres joués : lecture" on public.track_plays for select using (public.can_see_store(store_id));

-- Stockage des fichiers musicaux (privé ; les lecteurs reçoivent des liens signés).
insert into storage.buckets (id, name, public) values ('music', 'music', false) on conflict do nothing;
create policy "musique : lecture" on storage.objects for select to authenticated using (bucket_id = 'music' and public.has_any_membership());
create policy "musique : dépôt régie" on storage.objects for insert to authenticated with check (bucket_id = 'music' and public.is_platform_admin());
create policy "musique : modification régie" on storage.objects for update to authenticated using (bucket_id = 'music' and public.is_platform_admin());
create policy "musique : suppression régie" on storage.objects for delete to authenticated using (bucket_id = 'music' and public.is_platform_admin());

-- Journal : les réglages musicaux sont tracés comme les spots.
create trigger audit_playlists after insert or update or delete on public.playlists for each row execute function public.audit();

-- Une liste « Rotation principale » pour chaque ambiance existante.
insert into public.playlists (org_id, ambience_id, name)
select org_id, id, 'Rotation principale' from public.ambiences;
