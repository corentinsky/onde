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

## Installer (Mac ou serveur Linux, Docker requis)

1. Régie → **Émetteur** → **Créer une clé** : la commande d’installation s’affiche, prête à copier.
2. La coller dans le Terminal :

   ```bash
   curl -fsSL https://onde-rust.vercel.app/emetteur/install.sh | ONDE_URL=https://onde-rust.vercel.app ONDE_CLE=… sh
   ```

Le dossier `~/onde-emetteur` est créé, l’image est construite (2 à 5 min la première fois) et le conteneur
démarre, puis redémarre tout seul avec Docker.

| Variable | Rôle | Par défaut |
|---|---|---|
| `ONDE_URL` | Adresse de la régie | `https://onde-rust.vercel.app` |
| `ONDE_CLE` | Clé de l’émetteur | — (obligatoire) |
| `PUBLIC_URL` | Adresse à laquelle les boutiques joignent les flux | `http://localhost:8000` |

Sur un serveur, mettre `PUBLIC_URL=https://flux.mondomaine.fr` derrière un proxy HTTPS (les lecteurs sont
en HTTPS : seul `localhost` est accepté en HTTP).

## Commandes utiles

```bash
cd ~/onde-emetteur
docker compose logs -f      # journal
docker compose restart      # redémarrer
docker compose down         # arrêter
```

## Fichiers

- `onde.liq` : script Liquidsoap (2.2.4, version d’Ubuntu 24.04, testée par Onde).
- `entrypoint.sh` : démarre Icecast (interne, port 8001), nginx (port 8000) puis Liquidsoap.
- `nginx.conf` : porte d’entrée publique, répond aux navigateurs (CORS, réseau local), ferme l’administration.
- `icecast.xml.in` : configuration d’Icecast (mot de passe interne tiré au hasard à chaque démarrage).
- `install.sh` : installation en une commande. Ces fichiers sont publiés sous `/emetteur/` par la construction de l’application.
