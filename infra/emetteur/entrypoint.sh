#!/bin/sh
# Démarre Icecast (interne), la porte d’entrée nginx (port 8000) et Liquidsoap.
set -e
DIR="${ONDE_DIR:-/etc/onde}"
LOGDIR="${ONDE_LOGDIR:-/var/log/onde-icecast}"
ICECAST_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
export ICECAST_PASSWORD
mkdir -p "$LOGDIR" && chown icecast2:icecast "$LOGDIR"
sed -e "s|@ICECAST_PASSWORD@|$ICECAST_PASSWORD|g" -e "s|@LOGDIR@|$LOGDIR|g" "$DIR/icecast.xml.in" > /tmp/onde-icecast.xml
icecast2 -b -c /tmp/onde-icecast.xml > /dev/null
nginx -c "$DIR/nginx.conf"
exec liquidsoap "$DIR/onde.liq"
