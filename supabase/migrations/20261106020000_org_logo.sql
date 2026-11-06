-- Logo de l’enseigne, affiché dans la régie et sur les lecteurs des boutiques.
-- Petite image recadrée dans le navigateur, gardée en data URL (300 Ko au plus).
alter table public.organizations
  add column logo text check (logo is null or (logo like 'data:image/%' and length(logo) <= 300000));
