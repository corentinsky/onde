# Émetteur Onde

Fabrique **un flux par enseigne** (MP3 128 kb/s) à partir de la programmation d’Onde.

```
Onde (régie)  ──  /api/emitter/next  ──▶  Liquidsoap  ──▶  Icecast  ──▶  nginx :8000  ──▶  boutiques
   choisit chaque titre : journée type,      enchaîne aux points       diffuse      CORS, métadonnées
   listes, espacements, points de mix,       de mix, applique le                    dans le flux
   volume (EBU R128)                         volume, annonce le titre
```

- **Onde décide**, l’émetteur exécute : rien à configurer dans Liquidsoap.
- Chaque titre est annoncé à Onde quand il démarre (`/api/emitter/started`) : titre en cours, historique.
- Les boutiques reçoivent les changements de titre **dans le flux** (métadonnées ICY) avec quelques secondes
  d’avance : elles placent leurs spots exactement entre deux titres, puis reprennent au début du suivant.
- Nouvelle enseigne, flux coupé ou réactivé : l’émetteur le voit en une minute et redémarre seul.

## Installer

1. Régie → **Émetteur** → **Créer une clé** : la commande d’installation s’affiche, prête à copier.
2. La coller dans le Terminal, sur le serveur (`ssh root@<adresse IP>`) ou sur un Mac :

   ```bash
   curl -fsSL https://onde-rust.vercel.app/emetteur/install.sh | ONDE_URL=https://onde-rust.vercel.app ONDE_CLE=… sh
   ```

**Sur un serveur Linux** (Ubuntu 24.04, Debian ; 1 cœur et 2 Go suffisent) : Docker s’installe si besoin, puis
Caddy sert les flux en **HTTPS** avec un certificat Let’s Encrypt obtenu et renouvelé tout seul :
pour l’adresse IP du serveur (certificat court, six jours) et pour `<ip-avec-tirets>.sslip.io` en secours.
L’émetteur vérifie chaque minute quelle adresse répond avec un certificat valide et l’annonce à Onde.
Ports **80 et 443** ouverts. Avec un nom de domaine (enregistrement DNS A vers le serveur) :
`ONDE_DOMAINE=flux.mondomaine.fr` devant `sh`.

**Sur un Mac** (essai) : Docker Desktop requis ; les flux sont sur `http://localhost:8000`, lisibles sur ce Mac
seulement (les lecteurs sont en HTTPS : seul `localhost` est accepté en HTTP).

Le dossier `~/onde-emetteur` est créé, l’image est construite (2 à 5 min la première fois) et les conteneurs
démarrent, puis redémarrent tout seuls avec Docker.

| Variable | Rôle | Par défaut |
|---|---|---|
| `ONDE_URL` | Adresse de la régie | `https://onde-rust.vercel.app` |
| `ONDE_CLE` | Clé de l’émetteur | — (obligatoire) |
| `ONDE_DOMAINE` | Nom de domaine des flux (serveur) | adresse IP du serveur |
| `PUBLIC_URL` | Adresse des flux imposée (désactive le HTTPS automatique) | `http://localhost:8000` sur Mac |
| `ONDE_LOCAL=1` | Sur Linux : installation locale, sans HTTPS | — |

**Bibliothèque musicale** : l’émetteur garde aussi les titres déposés depuis la régie (volume Docker
`bibliotheque`, dossier `/var/lib/onde/bibliotheque`). La régie envoie chaque fichier directement au serveur, les
lecteurs et la régie le lisent depuis le serveur : place et trafic ne dépendent plus du stockage Supabase. Chaque accès
passe par un lien signé par Onde qui expire (`/titres/<fichier>?s=…&e=…`, module `secure_link` de nginx) ; le secret
est l’empreinte SHA-256 de la clé de l’émetteur, que la régie garde à la place de la clé.

**Mise à jour** (même serveur) : `curl -fsSL https://onde-rust.vercel.app/emetteur/install.sh | sh`, sans clé :
elle est reprise de `~/onde-emetteur/.env`. Titres, cache et certificats sont conservés.

**Titres en cache** : chaque titre est téléchargé une seule fois et gardé sur le disque (volume Docker `titres`) ;
ceux qui ne passent plus depuis 30 jours sont effacés. Une bibliothèque de 100 titres occupe environ 600 Mo.

## Commandes utiles

```bash
cd ~/onde-emetteur
docker compose logs -f      # journal (sur serveur, avec sudo si besoin)
docker compose restart      # redémarrer
docker compose down         # arrêter
```

## Fichiers

- `onde.liq` : script Liquidsoap (2.2.4, version d’Ubuntu 24.04, testée par Onde).
- `entrypoint.sh` : démarre Icecast (interne, port 8001), nginx (port 8000) puis Liquidsoap ; ménage du cache,
  choix de l’adresse HTTPS publique.
- `docker-compose.serveur.yml` : sur serveur, ajoute Caddy (ports 80 et 443) ; le `Caddyfile` est écrit par `install.sh`.
- `nginx.conf` : porte d’entrée publique, répond aux navigateurs (CORS, réseau local), ferme l’administration.
- `icecast.xml.in` : configuration d’Icecast (mot de passe interne tiré au hasard à chaque démarrage).
- `install.sh` : installation en une commande. Ces fichiers sont publiés sous `/emetteur/` par la construction de l’application.
