-- Rotation automatique des listes : à intervalle régulier, les titres les plus diffusés passent
-- quelques semaines au repos et ceux dont le repos est fini reviennent (règles : packages/rules/src/rotation.ts).

alter table public.playlists
  add column rotation_days smallint check (rotation_days between 1 and 365),           -- vide = pas de rotation
  add column rotation_share smallint not null default 20 check (rotation_share between 5 and 60),
  add column rotation_rest_days smallint not null default 30 check (rotation_rest_days between 1 and 365),
  add column rotated_at timestamptz;

alter table public.playlist_tracks
  add column added_at timestamptz not null default now(),
  add column rested_until date;                                                            -- au repos jusqu’à cette date exclue

-- Historique des rotations, lisible par l’enseigne (ce qui est sorti, ce qui est revenu).
create table public.playlist_rotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  ran_at timestamptz not null default now(),
  trigger text not null default 'auto' check (trigger in ('auto', 'manual')),
  rested jsonb not null default '[]'::jsonb,     -- [{ track_id, title, artist, plays, until }]
  returned jsonb not null default '[]'::jsonb,   -- [{ track_id, title, artist }]
  active_count integer not null,
  total_count integer not null
);
create index playlist_rotations_list_time on public.playlist_rotations (playlist_id, ran_at desc);

alter table public.playlist_rotations enable row level security;
create policy "rotations : lecture membres" on public.playlist_rotations for select using (public.is_member(org_id));
create policy "rotations : gestion régie" on public.playlist_rotations for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
