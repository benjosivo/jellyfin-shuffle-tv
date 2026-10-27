# Fonctions communes à install.sh et uninstall.sh (à sourcer).
# shellcheck shell=bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USER_NAME="${USER:-$(id -un)}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CONFIG_DIR="${JELLYFIN_OFFICE_DIR:-$CONFIG_HOME/jellyfin-office}"
SYSTEMD_DIR="$CONFIG_HOME/systemd/user"
AUTOSTART_DIR="$CONFIG_HOME/autostart"
UNIT_NAME="jellyfin-office.service"

# step / ok / warn / die / have, gestionnaire de paquets (PM, pkg_install) et installation de
# MPV Shim, partagés avec /lecteur.sh.
# shellcheck source=mpv-shim.sh
source "$(dirname "${BASH_SOURCE[0]}")/mpv-shim.sh"

# Manifeste : ce que l'installation a réellement ajouté (une entrée « type valeur » par ligne).
# Il est conservé entre deux installations et lu par la désinstallation, qui ne retire que ça.
MANIFEST="$CONFIG_DIR/install-manifest"

manifest_add() {
  mkdir -p "$CONFIG_DIR"
  touch "$MANIFEST"
  grep -qxF -- "$*" "$MANIFEST" || printf '%s\n' "$*" >> "$MANIFEST"
}
manifest_has() { [[ -f "$MANIFEST" ]] && grep -qxF -- "$*" "$MANIFEST"; }
# Valeurs d'un type, dans l'ordre d'ajout.
manifest_values() { [[ -f "$MANIFEST" ]] && sed -n "s/^$1 //p" "$MANIFEST" || true; }

pkg_remove() {
  case "$PM" in
    pacman) sudo pacman -Rns --noconfirm "$1" ;;
    apt) sudo apt-get purge -y "$1" ;;
    dnf) sudo dnf remove -y "$1" ;;
    zypper) sudo zypper --non-interactive remove --clean-deps "$1" ;;
    *) return 1 ;;
  esac
}

# --- Instance déjà installée sur le réseau ---------------------------------------------------

# Adresses IPv4 de ce PC sur le réseau local (ni boucle locale, ni lien local 169.254).
local_ipv4s() {
  if have ip; then
    ip -4 -o addr show scope global 2>/dev/null | awk '{ split($4, a, "/"); print a[1] }'
  elif have hostname; then
    hostname -I 2>/dev/null | tr ' ' '\n'
  fi | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -vE '^(127|169\.254)\.' || true
}

# Réponse de /api/health d'une instance de l'application (voir src/api/routes.ts), lue sur stdin.
is_app_health() { grep -q '"app":"jellyfin-en-boucle"'; }
export -f is_app_health

# Instances de l'application sur le réseau local : GET /api/health sur le port $1 de chaque adresse
# du /24 de ce PC (254 au plus par interface), 64 à la fois. Affiche une URL par instance trouvée.
find_app_servers() {
  local port="$1" own
  have curl || return 0
  own="$(local_ipv4s)"
  [[ -n "$own" ]] || return 0
  local prefix i
  for prefix in $(sed -E 's/\.[0-9]+$//' <<<"$own" | sort -u); do
    for ((i = 1; i < 255; i++)); do echo "$prefix.$i"; done
  done | grep -vxF -f <(printf '%s\n' "$own") |
    PORT="$port" xargs -P 64 -n 1 bash -c \
      'curl -fsS -m 1 "http://$1:$PORT/api/health" 2>/dev/null | is_app_health && echo "http://$1:$PORT/"' _ |
    sort -t . -k 4 -n || true
}
