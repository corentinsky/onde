-- Bibliothèque musicale sur le serveur de l’émetteur : place et trafic illimités,
-- le stockage Supabase ne garde que les titres déjà déposés et les spots.

-- Où se trouve le fichier d’un titre.
alter table public.tracks
  add column location text not null default 'supabase' check (location in ('supabase', 'emitter'));

-- L’émetteur accepte les dépôts (version qui sert la bibliothèque) : renseigné à chaque signal de vie.
alter table public.emitters
  add column serves_library boolean not null default false;
