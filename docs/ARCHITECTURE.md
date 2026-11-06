# Architecture

```
                 ┌──────────────────────────── Vercel ────────────────────────────┐
  Régie, siège,  │  apps/web (Next.js)                                            │
  magasin  ───▶  │   • écrans (connexion Supabase Auth)                           │
  (navigateur)   │   • dépôt des morceaux : analyse dans le navigateur (@onde/audio)│
                 │   • /api/emitter/* → choix de chaque titre du flux             │
                 │   • /api/device/*  → programme, preuves des lecteurs           │
                 └──────┬──────────────────────────────┬──────────────────────────┘
                        │                              │ titre suivant (annoté)
            ┌───────────▼─────────────┐     ┌──────────▼──────────────────────────┐
            │ Supabase                 │     │ Émetteur (infra/emetteur, Docker)   │
            │ enseignes, boutiques,    │     │ Liquidsoap : enchaînements, volume  │
            │ spots, bibliothèque,     │     │ Icecast + nginx : un flux par       │
            │ listes, journée type,    │     │ enseigne, titres annoncés dans le   │
            │ flux, preuves, titres    │     │ flux                                │
            └───────────▲─────────────┘     └──────────┬──────────────────────────┘
                        │ jeton du lecteur             │ flux MP3 + métadonnées
            ┌───────────┴──────────────────────────────▼──────────────────────────┐
            │ Lecteur boutique : écoute le flux de l’enseigne avec 8 s d’avance,   │
            │ place ses spots entre deux titres (pause, spots, reprise au titre    │
            │ suivant), joue la musique en cache si le flux coupe, envoie signal   │
            │ de vie, preuves et titres joués                                     │
            └──────────────────────────────────────────────────────────────────────┘
```

Un flux externe (AzuraCast…) reste possible pour une ambiance (`ambiences.stream_url`) : le lecteur le joue
tel quel, sans repérage exact des titres.

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
| `GET /api/device/nowplaying` | flux Onde : titres récents et à venir ; sinon titre en cours d’AzuraCast |

Toutes les routes sauf `pair` exigent `Authorization: Bearer <jeton>`.

## Son des spots

- **Voix IA** (ElevenLabs, clé `ELEVENLABS_API_KEY` côté serveur) : le texte est transformé en voix par le serveur,
  puis le navigateur ajoute un fond musical facultatif (un titre de la bibliothèque, 16 LU sous la voix),
  normalise à −18 LUFS (crête sous −1 dBFS) et enregistre un WAV dans `spots/<enseigne>/`.
- **Fichier produit** (agence, siège) : même normalisation, même dossier.
- **Texte seul** : lu par la voix de l’appareil, pour les essais.
Le lecteur reçoit un fichier normal : identique dans toutes les boutiques, jouable hors connexion.

## API de l’émetteur

| Route | Rôle |
|---|---|
| `GET /api/emitter/config` | flux à diffuser (une ligne par enseigne) ; signal de vie, adresse publique |
| `GET /api/emitter/next?org=` | titre suivant : `annotate:liq_cue_in,liq_cue_out,liq_cross_duration,liq_fade_in,liq_fade_out,liq_amplify…:onde:<fichier>\|<lien signé>` |
| `POST /api/emitter/started?play=` | le titre vient de démarrer (titre en cours, historique `stream_plays`) |

Clé de l’émetteur (`Authorization: Bearer`), créée dans Régie → Émetteur, stockée hachée (`emitters`).

`<fichier>` est le nom du titre dans le stockage (identifiant + extension) : l’émetteur garde chaque titre sur
son disque et ne le télécharge qu’une fois ; les titres non joués depuis 30 jours sont effacés. Sur un serveur,
Caddy sert les flux en HTTPS (certificat Let’s Encrypt de l’adresse IP, ou d’un nom de domaine) et l’émetteur
annonce à Onde la première adresse HTTPS valide. Les lecteurs ne reçoivent qu’une adresse qu’un navigateur
peut lire depuis une page HTTPS (`playableAddress`).

**Bibliothèque sur l’émetteur** (`tracks.location = 'emitter'`) : la régie dépose les titres directement sur le serveur
de l’émetteur qui l’annonce (`emitters.serves_library`), avec un lien signé `PUT /titres/<fichier>` valable 30 min ;
lecteurs, régie et autres émetteurs lisent avec un lien signé `GET` (`lib/library.ts`). Signature :
`md5(<expiration><méthode><chemin> <empreinte de la clé>)`, vérifiée par nginx (`secure_link`). L’émetteur qui garde
un titre le lit sur son disque (`onde:<fichier>|local`). Les titres déjà dans Supabase y restent.

## Spots magasin par magasin, sur un flux commun

1. Le lecteur lit le flux par `fetch` (métadonnées ICY) et le joue via MediaSource avec **8 s de marge** :
   chaque changement de titre est connu avant d’être entendu.
2. Écran dû (`packages/rules`) : au changement de titre, fondu, **pause du flux**, spots de la boutique,
   puis **reprise au début du titre suivant**, sans le chevauchement de l’ancien titre.
3. Le différé accumulé (quelques minutes par jour) est rattrapé en sautant au début d’un titre plus récent,
   jamais en coupant un morceau.
4. Spots « à la seconde » et urgences : la musique baisse par-dessus le flux, sans pause.
5. Flux coupé plus de 10 s : la bibliothèque en cache prend l’antenne (mêmes règles) ; le flux reprend au
   prochain enchaînement dès qu’il revient.

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
le flux est fabriqué une fois par enseigne et partagé par toutes ses boutiques.

Code : `packages/audio` (analyse, testée sur les signaux de référence EBU 3341), `packages/rules/src/music.ts`
(choix du titre, testé), `apps/web/src/lib/stream.ts` (titre suivant du flux), `infra/emetteur` (Liquidsoap),
`apps/web/src/app/lecteur/StreamPlayer.ts` et `StreamDirector.ts` (écoute du flux, spots),
`MusicEngine.ts` (musique en cache, secours).


## Rotation automatique des listes

Chaque liste peut se renouveler seule (7, 15 ou 30 jours ; `playlists.rotation_days`). Chaque matin, la tâche
planifiée de Vercel (`vercel.json` → `/api/cron/rotation`) traite les listes dont l’échéance est arrivée
(`lib/rotation.ts`) : les titres les plus diffusés depuis la dernière rotation (flux de l’enseigne, sinon passages
en boutique dédoublonnés) passent au repos (`playlist_tracks.rested_until`, 30 jours par défaut), ceux dont le
repos est fini reviennent, les titres ajoutés depuis la dernière rotation sont protégés, et la moitié de la liste
au moins reste en rotation (règles pures et testées : `packages/rules/src/rotation.ts`). Les titres au repos ne
sont ni diffusés par l’émetteur ni proposés aux lecteurs. Historique : `playlist_rotations`, affiché sur la fiche
de la liste, avec un bouton « Renouveler maintenant ». Avec `CRON_SECRET` défini sur Vercel, seul Vercel peut
lancer la tâche ; sans lui, un appel extérieur ne fait que les rotations déjà dues.


## Voix posées sur l’intro (a cappella)

Une liste marquée « Voix posée sur l’intro » (`playlists.is_overlay`, type « tous les X titres ») ne passe pas
entre deux titres : tous les X titres, Onde choisit une de ses voix (`overlayDue`, `pickOverlay` dans
`packages/rules/src/overlay.ts`, en évitant les plus récentes) et l’annonce avec le titre suivant
(`onde_overlay`, `onde_overlay_gain`, `onde_overlay_delay`). L’émetteur la mixe par-dessus le début du titre,
juste après le chevauchement avec le précédent, et baisse la musique de 10 dB dessous, en douceur (`onde.liq`).
Historique : `stream_plays.overlay_track_id`. Les lecteurs en musique de secours (sans flux) ne posent pas de voix.
