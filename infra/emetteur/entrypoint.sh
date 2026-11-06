#!/bin/sh
# Démarre Icecast (interne), la porte d’entrée nginx (port 8000) et Liquidsoap.
set -e
DIR="${ONDE_DIR:-/etc/onde}"
LOGDIR="${ONDE_LOGDIR:-/var/log/onde-icecast}"
ONDE_CACHE="${ONDE_CACHE:-/var/cache/onde}"
ONDE_BIBLIOTHEQUE="${ONDE_BIBLIOTHEQUE:-/var/lib/onde/bibliotheque}"
export ONDE_CACHE ONDE_BIBLIOTHEQUE
ICECAST_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
export ICECAST_PASSWORD
mkdir -p "$LOGDIR" "$ONDE_CACHE" && chown icecast2:icecast "$LOGDIR"
sed -e "s|@ICECAST_PASSWORD@|$ICECAST_PASSWORD|g" -e "s|@LOGDIR@|$LOGDIR|g" "$DIR/icecast.xml.in" > /tmp/onde-icecast.xml
icecast2 -b -c /tmp/onde-icecast.xml > /dev/null
# Bibliothèque : fichiers déposés par la régie (nginx les écrit sous l’utilisateur nobody).
mkdir -p "$ONDE_BIBLIOTHEQUE/.envoi" && chown -R nobody:nogroup "$ONDE_BIBLIOTHEQUE" 2>/dev/null || true
# Secret des liens signés : l’empreinte de la clé, que la régie garde (jamais la clé elle-même).
SECRET="$(printf '%s' "$ONDE_CLE" | sha256sum | cut -d' ' -f1)"
sed -e "s|@SECRET@|$SECRET|g" -e "s|@BIBLIOTHEQUE@|$ONDE_BIBLIOTHEQUE|g" "$DIR/nginx.conf" > /tmp/onde-nginx.conf
nginx -c /tmp/onde-nginx.conf

# Ménage du cache des titres, une fois par jour : téléchargements inachevés, titres non joués depuis 30 jours.
(
  while :; do
    find "$ONDE_CACHE" -type f \( -name '*.part' -mmin +120 -o -mtime +30 \) -delete 2>/dev/null || true
    sleep 86400
  done
) &

# Sur un serveur : l’adresse publique des flux est la première adresse HTTPS qui répond avec un
# certificat valide (le certificat peut prendre une minute à arriver). Vérifié chaque minute.
if [ -n "$PUBLIC_CANDIDATES" ]; then
  (
    while :; do
      for u in $PUBLIC_CANDIDATES; do
        if curl -fsS -o /dev/null --max-time 8 ${HTTPS_VIA:+--connect-to "::$HTTPS_VIA"} "$u/" 2>/dev/null; then
          if [ "$(cat /tmp/onde-public-url 2>/dev/null)" != "$u" ]; then
            echo "$u" > /tmp/onde-public-url.new && mv /tmp/onde-public-url.new /tmp/onde-public-url
            echo "Adresse publique des flux : $u"
          fi
          break
        fi
      done
      sleep 60
    done
  ) &
fi

exec liquidsoap "$DIR/onde.liq"
