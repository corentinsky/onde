#!/usr/bin/env bash
# Installe AzuraCast sur un serveur Ubuntu 24.04 neuf (Hetzner conseillé).
# À coller dans la console du serveur, en root :
#   curl -fsSL https://raw.githubusercontent.com/corentinsky/onde/main/infra/azuracast/install.sh | bash
# (le dépôt étant privé, copiez plutôt ce fichier dans la console et lancez « bash install.sh »)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Lancez ce script en root."; exit 1; fi

echo "→ Mise à jour du système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y curl ufw unattended-upgrades

echo "→ Pare-feu : SSH, web, et ports des flux"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000:8500/tcp
ufw --force enable

echo "→ Installation d’AzuraCast (procédure officielle Docker)"
mkdir -p /var/azuracast
cd /var/azuracast
curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh -o docker.sh
chmod +x docker.sh
yes 'Y' | ./docker.sh setup-release || true
./docker.sh install

cat <<'MSG'

AzuraCast est installé.
Étapes suivantes (voir docs/MISE-EN-PLACE.md) :
  1. Ouvrez http://IP-DU-SERVEUR et créez le compte administrateur.
  2. Créez une station par ambiance (ex. aubert_signature, aubert_soft, aubert_energie).
  3. Dans chaque station : Profil → AutoDJ → activez le calage automatique (autocue).
  4. Administration → Clés API → créez une clé, et collez-la dans AZURACAST_API_KEY (Vercel).
MSG
