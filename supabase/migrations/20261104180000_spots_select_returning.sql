-- Correctif : « insert … returning » sur les spots échouait (RLS).
-- La politique de lecture relisait la table via can_see_spot(), qui ne voit pas
-- encore la ligne en cours d'insertion. On teste d'abord les colonnes de la ligne.
drop policy if exists "spots : lecture" on public.spots;
create policy "spots : lecture" on public.spots for select using (
  public.is_org_manager(org_id) or created_by = auth.uid() or public.can_see_spot(id)
);
