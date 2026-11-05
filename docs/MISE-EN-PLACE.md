# Mise en place

Ce qu’il faut faire une seule fois pour passer du mode démo à la vraie plateforme.
Compter environ une heure. Les étapes marquées **(toi)** demandent ton compte ou ta carte ; tout le reste est déjà dans le code.

---

## 1. Supabase — la base de données (toi, 15 min)

1. Crée un compte sur [supabase.com](https://supabase.com) puis **New project**.
   - Nom : `onde` · Région : **Europe (Paris ou Francfort)** · note bien le **mot de passe de la base**.
2. **Project Settings → General** : copie le **Reference ID** (ex. `abcd1234…`).
3. **Account → Access Tokens** : crée un jeton nommé `github`, copie-le.
4. Sur GitHub, dépôt `onde` → **Settings → Secrets and variables → Actions → New repository secret**, crée :
   | Nom | Valeur |
   |---|---|
   | `SUPABASE_PROJECT_ID` | le Reference ID |
   | `SUPABASE_DB_PASSWORD` | le mot de passe de la base |
   | `SUPABASE_ACCESS_TOKEN` | le jeton créé à l’étape 3 |
5. Onglet **Actions** du dépôt → « Mise à jour de la base Supabase » → **Run workflow**.
   La base est créée avec toutes les tables et la sécurité.

### Te donner les droits de la régie

1. Supabase → **Authentication → Users → Invite user** : ton adresse e-mail. Ouvre le lien reçu.
2. Supabase → **SQL Editor**, colle et lance (en remplaçant l’adresse) :

```sql
update public.profiles set is_platform_admin = true
where id = (select id from auth.users where email = 'ton.adresse@exemple.fr');

-- Première enseigne (exemple)
insert into public.organizations (name, slug) values ('Nom de l’enseigne', 'nom-enseigne');
```

---

## 2. Vercel — l’application web (toi, 10 min)

1. Crée un compte sur [vercel.com](https://vercel.com) **avec ton GitHub**.
2. **Add New → Project** → importe `corentinsky/onde`.
3. **Root Directory** : `apps/web` (laisse le reste par défaut).
4. **Environment Variables** (valeurs dans Supabase → Project Settings → API) :
   | Nom | Où la trouver |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé `anon` `public` |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` (secrète, jamais ailleurs) |
5. **Deploy**. Note l’adresse obtenue (ex. `onde.vercel.app`).
6. Retour dans Supabase → **Authentication → URL Configuration** :
   - Site URL : l’adresse Vercel
   - Redirect URLs : `https://ton-adresse/auth/callback`

À partir de là, chaque envoi sur GitHub met le site à jour tout seul.

---

## 3. Musique et flux

1. **Bibliothèque** : déposez les morceaux dans Régie → Bibliothèque. Onde les analyse (volume, début,
   fin, enchaînement) et les range dans les listes. Les fichiers lourds (WAV, FLAC, MP3 à plus de 200 kb/s)
   sont compressés en MP3 192 kb/s dans le navigateur avant l’envoi : environ 5,5 Mo par titre de 4 min,
   donc 100 titres tiennent dans le stockage gratuit de Supabase (1 Go), avec de la marge.
2. **Émetteur** (le flux de chaque enseigne) : Régie → Émetteur → Créer une clé, puis coller la commande
   affichée. Détails : [infra/emetteur](../infra/emetteur/README.md).
   - **Serveur** (production) : un VPS Linux sous Ubuntu 24.04, 1 cœur et 2 Go suffisent. Se connecter avec
     `ssh root@<adresse IP>` depuis le Terminal du Mac et coller la commande : Docker s’installe, le certificat
     HTTPS s’obtient tout seul (adresse IP du serveur, ou `ONDE_DOMAINE=flux.mondomaine.fr`). Ports 80 et 443
     ouverts.
   - **Mac** (essai) : Docker Desktop, puis la même commande. Les flux ne s’écoutent que sur ce Mac.
3. **Lecteurs** : rien à faire. Ils écoutent le flux de leur enseigne dès que l’émetteur est en service
   (adresse HTTPS), et jouent la musique en cache sinon.

**Coûts** (novembre 2026, TTC) : le serveur le moins cher qui convient est l’IONOS VPS S+ (1 cœur, 2 Go,
60 Go, trafic illimité) : 2,40 € par mois les trois premiers mois puis 6 €, plus 12 € de mise en service.
Alternative sans frais de mise en service, facturée à l’heure : Hetzner CX23 (environ 7,20 €). Supabase et
Vercel restent dans leurs offres gratuites pour un essai : l’émetteur garde les titres sur son disque
(un seul téléchargement par titre) et chaque lecteur ne télécharge la bibliothèque qu’une fois.

## 4. Avant de diffuser dans un vrai magasin (toi)

- Droits : accord **SCPP/SPPF** (reproduction, en tant que prestataire) et vérification **SACEM/SPRE** côté magasins.
- Nom de domaine (ex. `onde.fr`) relié à Vercel, et un sous-domaine pour les flux (`ONDE_DOMAINE=flux.onde.fr` à l’installation de l’émetteur).
- Matériel du pilote : une tablette ou un mini-PC par boutique.

## Ce qui vient ensuite (moi)

- Espace **Siège** et espace **Magasin** sur la même base.
- **Lecteur boutique** : page plein écran pour le pilote, puis programme pour boîtier avec musique en avance.
- Invitations des utilisateurs depuis la régie, calendrier, rapport de campagne.
