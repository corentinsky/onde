# Architecture

```
                 ┌──────────────────────────── Vercel ────────────────────────────┐
  Régie, siège,  │  apps/web (Next.js)                                            │
  magasin  ───▶  │   • écrans (connexion par lien e-mail, Supabase Auth)          │
  (navigateur)   │   • actions serveur → Supabase avec la session de l’utilisateur │
                 │   • /api/device/* → Supabase avec la clé de service           │
                 │   • lib/azuracast.ts → API AzuraCast (clé côté serveur)        │
                 └───────────────┬───────────────────────────────┬────────────────┘
                                 │                               │
                     ┌───────────▼───────────┐       ┌───────────▼────────────┐
                     │ Supabase (Postgres)    │       │ AzuraCast (Hetzner)    │
                     │ sociétés, boutiques,   │       │ bibliothèque commune,  │
                     │ spots, règles, preuves,│       │ un flux par ambiance,  │
                     │ incidents, journal     │       │ calage automatique     │
                     │ + sécurité par ligne   │       └───────────▲────────────┘
                     └───────────▲───────────┘                   │ flux audio
                                 │ jeton du lecteur              │
                     ┌───────────┴───────────────────────────────┴────────────┐
                     │ Lecteur boutique : joue le flux, insère ses spots selon │
                     │ packages/rules, envoie signal de vie et preuves         │
                     └─────────────────────────────────────────────────────────┘
```

## Principes

- **Une société = une organisation.** Toutes les tables portent `org_id`. La sécurité par ligne
  (`supabase/migrations`) garantit qu’une enseigne ne voit jamais les données d’une autre.
  Testé par `supabase/tests/rls.sql` (24 vérifications, lancées à chaque envoi).
- **Rôles** : régie (`profiles.is_platform_admin`, voit tout), siège (`hq`), régional, responsable
  de boutique. Les boutiques proposent des messages, la régie valide (`review_spot`).
- **Un seul moteur de règles** (`packages/rules`) pour la simulation de la régie et pour les
  lecteurs. Priorités, écrans entre deux titres, plafonds, fenêtres, urgence, spots synchronisés.
- **Le lecteur est autonome** : il récupère son programme (`GET /api/device/schedule`), joue même
  hors connexion, et renvoie ses preuves par lots (`POST /api/device/playlog`).
- **Secrets** : la clé de service Supabase et la clé AzuraCast ne quittent jamais le serveur.
  Les jetons des lecteurs ne sont stockés que hachés.
- **Mode démo** : sans variables Supabase, l’application affiche des données fictives.

## API des lecteurs

| Route | Rôle |
|---|---|
| `POST /api/device/pair` | `{ code }` → `{ token }` une seule fois |
| `POST /api/device/heartbeat` | toutes les 30 s : titre, musique en avance, niveau de sortie |
| `GET /api/device/schedule` | règles, spots du jour pour la boutique, zones, état du réseau |
| `POST /api/device/playlog` | preuves de diffusion par lots |

Toutes les routes sauf `pair` exigent `Authorization: Bearer <jeton>`.
