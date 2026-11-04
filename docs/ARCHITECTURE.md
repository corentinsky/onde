# Architecture

```
                 ┌──────────────────────────── Vercel ────────────────────────────┐
  Régie, siège,  │  apps/web (Next.js)                                            │
  magasin  ───▶  │   • écrans (connexion Supabase Auth)                           │
  (navigateur)   │   • dépôt des morceaux : analyse dans le navigateur (@onde/audio)│
                 │   • actions serveur → Supabase avec la session de l’utilisateur │
                 │   • /api/device/* → Supabase avec la clé de service           │
                 └───────────────┬────────────────────────────────────────────────┘
                                 │
                     ┌───────────▼──────────────────────────────┐
                     │ Supabase                                  │
                     │ Postgres : sociétés, boutiques, spots,    │
                     │ règles, bibliothèque, listes, journée     │
                     │ type, preuves, titres joués, incidents    │
                     │ Stockage : spots/ et music/ (privés)      │
                     └───────────▲──────────────────────────────┘
                                 │ jeton du lecteur, liens signés 24 h
                     ┌───────────┴──────────────────────────────────────────────┐
                     │ Lecteur boutique : choisit chaque titre (@onde/rules),    │
                     │ normalise, enchaîne aux points de mix, garde la musique   │
                     │ en cache, insère les spots entre deux titres, envoie      │
                     │ signal de vie, preuves et titres joués                    │
                     └──────────────────────────────────────────────────────────┘
```

AzuraCast reste possible pour une ambiance diffusée en flux (`ambiences.stream_url`) : le lecteur
le joue alors tel quel. Sans flux ni bibliothèque, il n’y a pas de musique.

## Principes

- **Une société = une organisation.** Toutes les tables portent `org_id`. La sécurité par ligne
  (`supabase/migrations`) garantit qu’une enseigne ne voit jamais les données d’une autre.
  Testé par `supabase/tests/rls.sql`, lancé à chaque envoi.
- **Rôles** : régie (`profiles.is_platform_admin`, voit tout), siège (`hq`), régional, responsable
  de boutique. Les boutiques proposent des messages, la régie valide (`review_spot`).
- **Un seul moteur de règles** (`packages/rules`) pour la simulation de la régie et pour les
  lecteurs. Priorités, écrans entre deux titres, plafonds, fenêtres, urgence, spots synchronisés.
- **La musique est programmée dans Onde**, comme l’AutoDJ d’AzuraCast sans le direct (voir plus bas).
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
| `GET /api/device/schedule` | règles, spots du jour, zones, état du réseau, programmation musicale (titres, points de mix, liens signés 24 h) |
| `POST /api/device/playlog` | `entries` : preuves de diffusion des spots ; `tracks` : titres joués |

Toutes les routes sauf `pair` exigent `Authorization: Bearer <jeton>`.

## Musique : l’équivalent d’AzuraCast, sans le direct

| AzuraCast | Onde |
|---|---|
| Médias, métadonnées | **Bibliothèque** commune (`tracks`, stockage `music/`) : titre, artiste, album, genre, ISRC |
| ReplayGain / normalisation | Volume intégré **EBU R128** (ITU-R BS.1770-4, blocs de 400 ms, portes −70 LUFS et −10 LU), crête ; gain = cible de l’ambiance (−18 LUFS par défaut), plafonné pour garder la crête sous −1 dBFS |
| Autocue : cue in, cue out, cross start | Début et fin audibles (−42 LU sous le volume intégré), **point de chevauchement** (−8 LU, −20 LU pour les longues fins), fondus d’entrée et de sortie ; éditeur visuel, réglages manuels jamais écrasés |
| Crossfade (normal, intelligent, désactivé) | Par ambiance : **intelligent** (chevauchement limité à 4 × la durée de fondu), normal, sans fondu ; durée réglable |
| Playlists : standard pondérée (1–25), une fois tous les X titres, toutes les X minutes, une fois par heure à la minute M | Identique (`playlists`), avec ordre **mélangé**, **aléatoire** ou **séquentiel** |
| Programmation des playlists (heures, jours, dates) | Identique, y compris les plages qui passent minuit |
| Prévention des doublons | Espacement **titre** (240 min) et **artiste** (90 min) par ambiance, assoupli seulement si la bibliothèque est trop petite |
| Jingles (« ne pas envoyer les métadonnées ») | Liste « jingle » : ne compte ni dans les espacements, ni dans « tous les X titres », ni dans l’historique |
| Historique des titres | `track_plays`, envoyé par chaque lecteur : base des relevés de diffusion |
| Direct (DJ en live) | Non prévu |

En plus : la **journée type** (`dayparts`) choisit l’ambiance selon l’heure de la boutique (fuseau de
la boutique, pas de l’appareil) ; l’analyse se fait dans le navigateur au dépôt, sans serveur audio ;
le lecteur garde les fichiers en cache et continue sans connexion ; un écran de spots dû en fin de
titre suspend l’enchaînement : le titre finit, les spots passent, puis la musique reprend.

Code : `packages/audio` (analyse, testée sur les signaux de référence EBU 3341), `packages/rules/src/music.ts`
(choix du titre, testé), `apps/web/src/app/lecteur/MusicEngine.ts` (lecture Web Audio).
