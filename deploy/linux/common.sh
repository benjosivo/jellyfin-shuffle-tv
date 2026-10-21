# Fonctions communes à install.sh et uninstall.sh (à sourcer).
# shellcheck shell=bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USER_NAME="${USER:-$(id -un)}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CONFIG_DIR="${JELLYFIN_OFFICE_DIR:-$CONFIG_HOME/jellyfin-office}"
SYSTEMD_DIR="$CONFIG_HOME/systemd/user"
AUTOSTART_DIR="$CONFIG_HOME/autostart"
UNIT_NAME="jellyfin-office.service"
FLATPAK_ID="com.github.iwalton3.jellyfin-mpv-shim"

# Manifeste : ce que l'installation a réellement ajouté (une entrée « type valeur » par ligne).
# Il est conservé entre deux installations et lu par la désinstallation, qui ne retire que ça.
MANIFEST="$CONFIG_DIR/install-manifest"

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

manifest_add() {
  mkdir -p "$CONFIG_DIR"
  touch "$MANIFEST"
  grep -qxF -- "$*" "$MANIFEST" || printf '%s\n' "$*" >> "$MANIFEST"
}
manifest_has() { [[ -f "$MANIFEST" ]] && grep -qxF -- "$*" "$MANIFEST"; }
# Valeurs d'un type, dans l'ordre d'ajout.
manifest_values() { [[ -f "$MANIFEST" ]] && sed -n "s/^$1 //p" "$MANIFEST" || true; }

# --- Gestionnaire de paquets --------------------------------------------------------------

PM=""
if have pacman; then PM=pacman
elif have apt-get; then PM=apt
elif have dnf; then PM=dnf
elif have zypper; then PM=zypper
fi

pkg_present() {
  case "$PM" in
    pacman) pacman -Q "$1" >/dev/null 2>&1 ;;
    apt) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed" ;;
    dnf|zypper) rpm -q "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# Installe les paquets manquants et note ceux qui ont été ajoutés.
pkg_install() {
  local missing=() pkg
  for pkg in "$@"; do pkg_present "$pkg" || missing+=("$pkg"); done
  [[ ${#missing[@]} -eq 0 ]] && return 0
  case "$PM" in
    pacman) sudo pacman -S --needed --noconfirm "${missing[@]}" ;;
    apt) sudo apt-get update && sudo apt-get install -y "${missing[@]}" ;;
    dnf) sudo dnf install -y "${missing[@]}" ;;
    zypper) sudo zypper --non-interactive install "${missing[@]}" ;;
    *) return 1 ;;
  esac || return 1
  for pkg in "${missing[@]}"; do pkg_present "$pkg" && manifest_add "package $pkg"; done
  return 0
}

pkg_remove() {
  case "$PM" in
    pacman) sudo pacman -Rns --noconfirm "$1" ;;
    apt) sudo apt-get purge -y "$1" ;;
    dnf) sudo dnf remove -y "$1" ;;
    zypper) sudo zypper --non-interactive remove --clean-deps "$1" ;;
    *) return 1 ;;
  esac
}

aur_helper() {
  if have paru; then echo paru
  elif have yay; then echo yay
  fi
}
