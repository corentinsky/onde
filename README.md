# Onde

Radios d’enseigne pour les réseaux de magasins : une **régie** qui programme et supervise,
un **siège** qui pilote ses campagnes, des **magasins** qui diffusent et proposent leurs messages.

## En un coup d’œil

| Dossier | Contenu |
|---|---|
| `apps/web` | Application web (Next.js) : régie, API des lecteurs |
| `packages/rules` | Moteur de règles de diffusion, partagé par la régie et les lecteurs |
| `supabase` | Schéma de la base, sécurité par ligne, données de démo, tests |
| `infra/azuracast` | Installation du moteur musical sur un serveur |
| `docs` | [Mise en place](docs/MISE-EN-PLACE.md) · [Architecture](docs/ARCHITECTURE.md) |

## Lancer en local

```bash
npm install
npm run dev        # http://localhost:3000 — mode démo tant que Supabase n’est pas configuré
npm test           # moteur de règles
npm run build
```

Tests de la base (nécessite un Postgres vide) :

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/onde npm run db:test
```

Configuration : copier `apps/web/.env.example` en `apps/web/.env.local`.

## État

- [x] Moteur de règles + tests
- [x] Base multi-sociétés, sécurité par ligne + tests
- [x] Régie : vue d’ensemble, supervision, fiche boutique, spots nationaux, messages, règles
- [x] API des lecteurs (appairage, signal de vie, programme, preuves)
- [ ] Espaces siège et magasin
- [ ] Lecteur boutique (page plein écran, puis boîtier)
- [ ] Invitations, calendrier, rapport de campagne
