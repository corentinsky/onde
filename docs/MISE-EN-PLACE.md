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
   fin, enchaînement) et les range dans les listes. Le stockage gratuit de Supabase (1 Go) suffit pour
   environ 150 à 250 titres en MP3 ; au-delà, forfait Pro (100 Go inclus).
2. **Émetteur** (le flux de chaque enseigne) : Régie → Émetteur → Créer une clé, puis coller la commande
   affichée dans le Terminal d’un Mac (test) ou d’un serveur (production). Docker requis.
   Détails : [infra/emetteur](../infra/emetteur/README.md).
3. **Lecteurs** : rien à faire. Ils écoutent le flux de leur enseigne dès que l’émetteur est en service,
   et jouent la musique en cache sinon.

Pour la production : un petit serveur (Hetzner CX23, environ 6 € par mois, tient une dizaine de flux)
et une adresse HTTPS pour les flux (`PUBLIC_URL`).

## 4. Avant de diffuser dans un vrai magasin (toi)

- Droits : accord **SCPP/SPPF** (reproduction, en tant que prestataire) et vérification **SACEM/SPRE** côté magasins.
- Nom de domaine (ex. `onde.fr`) relié à Vercel et à AzuraCast.
- Matériel du pilote : une tablette ou un mini-PC par boutique.

## Ce qui vient ensuite (moi)

- Espace **Siège** et espace **Magasin** sur la même base.
- **Lecteur boutique** : page plein écran pour le pilote, puis programme pour boîtier avec musique en avance.
- Invitations des utilisateurs depuis la régie, calendrier, rapport de campagne.
