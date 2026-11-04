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

## 3. Musique

**Par défaut, rien à installer** : déposez les morceaux dans **Régie → Bibliothèque**. Onde les
analyse (volume, début, fin, enchaînement), les range dans les listes, et chaque lecteur les joue
lui-même. Le stockage gratuit de Supabase (1 Go) suffit pour environ 150 à 250 titres en MP3 ;
au-delà, passer au forfait Pro (100 Go inclus).

### Option : un flux AzuraCast (Hetzner, 20 min)

Utile seulement pour diffuser une ambiance en flux continu plutôt que depuis la bibliothèque.

1. Compte sur [hetzner.com/cloud](https://www.hetzner.com/cloud) → **Add Server** :
   - Image **Ubuntu 24.04** · type **CPX32** (4 vCPU, 8 Go) pour le pilote · localisation Allemagne.
2. Ouvre la **console** du serveur (bouton `>_`), connecte-toi en `root`.
3. Copie le contenu de [`infra/azuracast/install.sh`](../infra/azuracast/install.sh) dans un fichier sur le serveur et lance-le :
   ```bash
   nano install.sh   # colle le contenu, Ctrl+O, Entrée, Ctrl+X
   bash install.sh
   ```
4. Ouvre `http://IP-DU-SERVEUR`, crée le compte administrateur AzuraCast.
5. Crée une **station par ambiance** (ex. `aubert_signature`, `aubert_soft`, `aubert_energie`).
   Dans chaque station : **Profil → AutoDJ** → active le **calage automatique (autocue)**.
6. **Administration → Clés API** → crée une clé.
7. Dans Vercel, ajoute :
   | Nom | Valeur |
   |---|---|
   | `AZURACAST_URL` | `http://IP-DU-SERVEUR` (puis le nom de domaine) |
   | `AZURACAST_API_KEY` | la clé créée |
   puis **Redeploy**. La vue d’ensemble affiche alors les flux en direct.

---

## 4. Avant de diffuser dans un vrai magasin (toi)

- Droits : accord **SCPP/SPPF** (reproduction, en tant que prestataire) et vérification **SACEM/SPRE** côté magasins.
- Nom de domaine (ex. `onde.fr`) relié à Vercel et à AzuraCast.
- Matériel du pilote : une tablette ou un mini-PC par boutique.

## Ce qui vient ensuite (moi)

- Espace **Siège** et espace **Magasin** sur la même base.
- **Lecteur boutique** : page plein écran pour le pilote, puis programme pour boîtier avec musique en avance.
- Invitations des utilisateurs depuis la régie, calendrier, rapport de campagne.
