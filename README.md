# Onde

Radios d’enseigne pour les réseaux de magasins : une **régie** qui programme et supervise,
un **siège** qui pilote ses campagnes, des **magasins** qui diffusent et proposent leurs messages.

## En un coup d’œil

| Dossier | Contenu |
|---|---|
| `apps/web` | Application web (Next.js) : régie, API des lecteurs |
| `packages/rules` | Règles de diffusion et programmation musicale, partagées par la régie et les lecteurs |
| `packages/audio` | Analyse audio : volume EBU R128, crête, points de mix |
| `supabase` | Schéma de la base, sécurité par ligne, données de démo, tests |
| `infra/azuracast` | Option : flux AzuraCast pour une ambiance |
| `docs` | [Mise en place](docs/MISE-EN-PLACE.md) · [Architecture](docs/ARCHITECTURE.md) |

## Lancer en local

```bash
npm install
npm run dev        # http://localhost:3000 — mode démo tant que Supabase n’est pas configuré
npm test           # règles, programmation musicale, analyse audio
npm run build
```

Tests de la base (nécessite un Postgres vide) :

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/onde npm run db:test
```

Configuration : copier `apps/web/.env.example` en `apps/web/.env.local`.

## En ligne

- Application : https://onde-rust.vercel.app (Vercel, déploiement automatique à chaque envoi sur `main`)
- Base : projet Supabase `onde`, région Paris (schéma et données de démo chargés)
- Lecteur boutique : https://onde-rust.vercel.app/lecteur

## État

- [x] Moteur de règles + tests
- [x] Base multi-sociétés, sécurité par ligne + tests
- [x] Régie : vue d’ensemble, supervision, fiche boutique, spots nationaux, messages, règles
- [x] API des lecteurs (appairage, signal de vie, programme, preuves)
- [ ] Espaces siège et magasin
- [x] Lecteur boutique, version navigateur (pilote)
- [x] Musique : bibliothèque, analyse EBU R128 et points de mix, listes et journée type, lecture avec enchaînements, cache hors ligne, titres joués
- [ ] Lecteur boîtier
- [ ] Invitations, calendrier, rapport de campagne
