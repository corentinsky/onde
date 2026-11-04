# Onde — consignes pour Claude

- Interface et documentation **en français**, ton sobre. Pas d’emoji dans l’interface.
- Design : tokens dans `apps/web/src/app/globals.css` (style Apple : fonds `#f5f5f7`, cartes blanches,
  pastilles arrondies, accent `#0071e3`). Réutiliser les classes existantes avant d’en créer.
- Toute nouvelle table porte `org_id` et active la sécurité par ligne. Ajouter les cas dans
  `supabase/tests/rls.sql` ; `npm run db:test` doit passer.
- Les migrations sont **additives** : nouveau fichier dans `supabase/migrations`, jamais de modification d’un fichier déjà appliqué.
- Logique de diffusion uniquement dans `packages/rules` (testée avec Vitest) ; la régie et le lecteur l’importent.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `AZURACAST_API_KEY`) : serveur uniquement, jamais dans un composant client.
- Avant d’envoyer : `npm test`, `npm run typecheck`, `npm run build`.
