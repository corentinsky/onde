#!/bin/sh
# Installe et démarre l’émetteur Onde (Docker requis).
#   curl -fsSL https://onde-rust.vercel.app/emetteur/install.sh | ONDE_CLE=… sh
set -e
BASE="${ONDE_URL:-https://onde-rust.vercel.app}"
DIR="${ONDE_DOSSIER:-$HOME/onde-emetteur}"
PUBLIC="${PUBLIC_URL:-http://localhost:8000}"

if [ -z "$ONDE_CLE" ]; then
  echo "Il manque la clé de l’émetteur (Régie → Émetteur → Créer une clé)."; exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker n’est pas installé : https://www.docker.com/products/docker-desktop/ puis relancez cette commande."; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker est installé mais pas démarré : ouvrez Docker Desktop, attendez qu’il soit prêt, puis relancez."; exit 1
fi

echo "Téléchargement de l’émetteur dans $DIR…"
mkdir -p "$DIR" && cd "$DIR"
for f in Dockerfile docker-compose.yml onde.liq nginx.conf icecast.xml.in entrypoint.sh; do
  curl -fsSL "$BASE/emetteur/$f" -o "$f"
done
chmod +x entrypoint.sh
umask 077
printf 'ONDE_URL=%s\nONDE_CLE=%s\nPUBLIC_URL=%s\n' "$BASE" "$ONDE_CLE" "$PUBLIC" > .env

echo "Construction et démarrage (2 à 5 minutes la première fois)…"
docker compose up -d --build
echo ""
echo "Émetteur démarré. Il apparaît « en service » dans Régie → Émetteur d’ici une minute."
echo "Flux : $PUBLIC/<enseigne>   Arrêt : cd $DIR && docker compose down"
