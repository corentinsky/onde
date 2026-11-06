-- Voix posées sur l’intro (a cappella) : une liste « voix » n’est pas jouée entre deux titres,
-- ses fichiers sont mixés par l’émetteur sur le début du titre suivant, tous les N titres, musique baissée dessous.
alter table public.playlists
  add column is_overlay boolean not null default false;

-- Voix posée sur un titre du flux (historique, et rythme « tous les N titres »).
alter table public.stream_plays
  add column overlay_track_id uuid references public.tracks (id) on delete set null;
