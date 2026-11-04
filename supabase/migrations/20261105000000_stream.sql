-- Flux musical par enseigne, fabriqué par un émetteur (Liquidsoap + Icecast) piloté par Onde.
-- Onde choisit chaque titre (listes, journée type, espacements, points de mix, volume) ;
-- l’émetteur enchaîne et diffuse ; chaque boutique écoute le flux et place ses spots.

-- ───────────── Émetteurs ─────────────
-- Ressource de la plateforme (un émetteur sert plusieurs enseignes) : pas d’org_id,
-- accès réservé à la régie. Le jeton n’est stocké que haché.
create table public.emitters (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Émetteur',
  token_hash text not null unique,
  public_url text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- ───────────── Flux des enseignes ─────────────
create table public.streams (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  mount text not null unique check (mount ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  enabled boolean not null default true,
  -- Ambiance hors créneau de la journée type (sinon : la première par ordre alphabétique).
  default_ambience_id uuid references public.ambiences (id) on delete set null,
  -- État des rotations (ordre mélangé, pointeur séquentiel) de chaque liste.
  rotation_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Historique du flux : chaque titre choisi (queued_at), puis réellement lancé (started_at).
create table public.stream_plays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  ambience_id uuid references public.ambiences (id) on delete set null,
  track_id uuid references public.tracks (id) on delete set null,
  playlist_id uuid references public.playlists (id) on delete set null,
  title text not null default '',
  artist text not null default '',
  isrc text,
  is_jingle boolean not null default false,
  -- Durée utile (début → fin) et chevauchement avec le titre suivant.
  duration_sec numeric(8,2),
  cross_sec numeric(6,2),
  queued_at timestamptz not null default now(),
  started_at timestamptz
);
create index stream_plays_org_queued on public.stream_plays (org_id, queued_at desc);
create index stream_plays_org_started on public.stream_plays (org_id, started_at desc) where started_at is not null;

-- ───────────── Sécurité ─────────────
alter table public.emitters enable row level security;
alter table public.streams enable row level security;
alter table public.stream_plays enable row level security;

create policy "émetteurs : régie" on public.emitters for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "flux : lecture membres" on public.streams for select using (public.is_member(org_id));
create policy "flux : gestion régie" on public.streams for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Écrit uniquement par l’API de l’émetteur (clé de service).
create policy "flux joués : lecture membres" on public.stream_plays for select using (public.is_member(org_id));

create trigger audit_streams after insert or update of mount, enabled, default_ambience_id or delete on public.streams
  for each row execute function public.audit();
