#!/bin/sh
# Installe et démarre l’émetteur Onde.
#   curl -fsSL https://onde-rust.vercel.app/emetteur/install.sh | ONDE_CLE=… sh
# Mise à jour (même serveur) : la même commande sans ONDE_CLE.
#
# Sur un Mac : Docker Desktop requis, flux sur http://localhost:8000 (test).
# Sur un serveur Linux (Ubuntu, Debian) : installe Docker si besoin et sert les flux en HTTPS,
# avec un certificat obtenu et renouvelé tout seul. Option : ONDE_DOMAINE=flux.mondomaine.fr
# (un enregistrement DNS A vers le serveur), sinon l’adresse IP du serveur est utilisée.
set -e
BASE="${ONDE_URL:-https://onde-rust.vercel.app}"
DIR="${ONDE_DOSSIER:-$HOME/onde-emetteur}"

# Mise à jour d’un émetteur déjà installé : la clé est reprise de l’installation précédente.
if [ -z "$ONDE_CLE" ] && [ -f "$DIR/.env" ]; then
  ONDE_CLE="$(sed -n 's/^ONDE_CLE=//p' "$DIR/.env" | head -n 1)"
  [ -n "$ONDE_URL" ] || BASE="$(sed -n 's/^ONDE_URL=//p' "$DIR/.env" | head -n 1)"
  BASE="${BASE:-https://onde-rust.vercel.app}"
  echo "Mise à jour de l’émetteur installé dans $DIR."
fi
if [ -z "$ONDE_CLE" ]; then
  echo "Il manque la clé de l’émetteur (Régie → Émetteur → Créer une clé)."; exit 1
fi

SERVEUR=0
if [ "$(uname -s)" = "Linux" ] && [ -z "$PUBLIC_URL" ] && [ "${ONDE_LOCAL:-0}" != "1" ]; then SERVEUR=1; fi

SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

if ! command -v docker >/dev/null 2>&1; then
  if [ "$SERVEUR" = "1" ]; then
    echo "Installation de Docker…"
    curl -fsSL https://get.docker.com | $SUDO sh
  else
    echo "Docker n’est pas installé : https://www.docker.com/products/docker-desktop/ puis relancez cette commande."; exit 1
  fi
fi
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then
    DOCKER="$SUDO docker"
  elif [ "$SERVEUR" = "1" ]; then
    $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
    sleep 3
    $SUDO docker info >/dev/null 2>&1 && DOCKER="$SUDO docker" || { echo "Docker ne démarre pas sur ce serveur."; exit 1; }
  else
    echo "Docker est installé mais pas démarré : ouvrez Docker Desktop, attendez qu’il soit prêt, puis relancez."; exit 1
  fi
fi

echo "Téléchargement de l’émetteur dans $DIR…"
mkdir -p "$DIR" && cd "$DIR"
for f in Dockerfile docker-compose.yml docker-compose.serveur.yml onde.liq nginx.conf icecast.xml.in entrypoint.sh; do
  curl -fsSL "$BASE/emetteur/$f" -o "$f"
done
chmod +x entrypoint.sh
umask 077

if [ "$SERVEUR" = "1" ]; then
  IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || curl -4 -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)"
  if ! echo "$IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    echo "Adresse IP publique introuvable. Relancez avec ONDE_DOMAINE=flux.mondomaine.fr"; exit 1
  fi
  NOM_IP="$(echo "$IP" | tr . -).sslip.io"
  PUBLIC="http://$IP:8000"
  {
    echo "# Généré par install.sh : HTTPS devant l’émetteur, certificats automatiques."
    echo "{"
    echo "	# Un navigateur n’annonce pas de nom (SNI) pour une adresse IP : on sert alors le certificat de l’IP."
    echo "	default_sni $IP"
    echo "}"
    if [ -n "$ONDE_DOMAINE" ]; then
      echo "https://$ONDE_DOMAINE {"
      echo "	reverse_proxy emetteur:8000 {"
      echo "		flush_interval -1"
      echo "	}"
      echo "}"
    fi
    echo "# Adresse IP du serveur : certificat court (6 jours), renouvelé tout seul."
    echo "https://$IP {"
    echo "	tls {"
    echo "		issuer acme {"
    echo "			profile shortlived"
    echo "		}"
    echo "	}"
    echo "	reverse_proxy emetteur:8000 {"
    echo "		flush_interval -1"
    echo "	}"
    echo "}"
    echo "# Nom de secours qui pointe vers la même adresse IP."
    echo "https://$NOM_IP {"
    echo "	reverse_proxy emetteur:8000 {"
    echo "		flush_interval -1"
    echo "	}"
    echo "}"
  } > Caddyfile
  chmod 644 Caddyfile
  CANDIDATES="${ONDE_DOMAINE:+https://$ONDE_DOMAINE }https://$IP https://$NOM_IP"
  printf 'ONDE_URL=%s\nONDE_CLE=%s\nPUBLIC_URL=%s\nPUBLIC_CANDIDATES="%s"\nCOMPOSE_FILE=docker-compose.yml:docker-compose.serveur.yml\n' "$BASE" "$ONDE_CLE" "$PUBLIC" "$CANDIDATES" > .env
else
  PUBLIC="${PUBLIC_URL:-http://localhost:8000}"
  printf 'ONDE_URL=%s\nONDE_CLE=%s\nPUBLIC_URL=%s\n' "$BASE" "$ONDE_CLE" "$PUBLIC" > .env
fi

echo "Construction et démarrage (2 à 5 minutes la première fois)…"
$DOCKER compose up -d --build
$DOCKER image prune -f >/dev/null 2>&1 || true
echo ""
echo "Émetteur démarré. Il apparaît « en service » dans Régie → Émetteur d’ici une minute."
if [ "$SERVEUR" = "1" ]; then
  echo "Flux en HTTPS dès que le certificat est obtenu (une à deux minutes) : https://$IP/<enseigne>"
  echo "Ports 80 et 443 à ouvrir si l’hébergeur a un pare-feu."
fi
echo "Journal : cd $DIR && $DOCKER compose logs -f    Arrêt : cd $DIR && $DOCKER compose down"
