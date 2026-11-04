-- Fichiers audio des spots : dépôt d’un fichier produit ou voix générée par IA.
-- Rangés par enseigne : spots/<org_id>/<fichier>. Le fichier est normalisé (−18 LUFS) avant l’envoi.

alter table public.spots
  add column audio_kind text check (audio_kind in ('file', 'ai')),
  add column voice_name text;

-- Dossier d’enseigne d’un fichier de spot (premier segment du chemin), sans erreur si ce n’est pas un uuid.
create or replace function public.spot_file_org(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;

-- Écoute : les membres de l’enseigne. Dépôt : les membres (une boutique peut proposer un message).
-- Suppression : siège et régie.
create policy "spots audio : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'spots' and public.is_member(public.spot_file_org(name)));
create policy "spots audio : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'spots' and public.is_member(public.spot_file_org(name)));
create policy "spots audio : suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'spots' and public.is_org_manager(public.spot_file_org(name)));
