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
