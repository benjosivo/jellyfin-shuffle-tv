# Installation de Jellyfin MPV Shim sous Linux. Sourcé par common.sh (installation complète) et
# assemblé avec lecteur.sh par le serveur (/lecteur.sh, exécuté par « bash ») : ne pas utiliser
# $BASH_SOURCE ici. manifest_add est défini par common.sh, ou neutralisé par lecteur.sh.
# shellcheck shell=bash

FLATPAK_ID="com.github.iwalton3.jellyfin-mpv-shim"

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

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

aur_helper() {
  if have paru; then echo paru
  elif have yay; then echo yay
  fi
}

# --- Jellyfin MPV Shim --------------------------------------------------------------------

MPV_SHIM_CMD=""
detect_mpv_shim() {
  MPV_SHIM_CMD=""
  if have jellyfin-mpv-shim; then
    MPV_SHIM_CMD="$(command -v jellyfin-mpv-shim)"
  elif have flatpak && flatpak info "$FLATPAK_ID" >/dev/null 2>&1; then
    MPV_SHIM_CMD="flatpak run $FLATPAK_ID"
  elif [[ -x "$HOME/.local/bin/jellyfin-mpv-shim" ]]; then
    MPV_SHIM_CMD="$HOME/.local/bin/jellyfin-mpv-shim"
  fi
  [[ -n "$MPV_SHIM_CMD" ]]
}

install_mpv_shim() {
  local helper
  helper="$(aur_helper)"
  if [[ "$PM" == pacman && -n "$helper" ]]; then
    echo "Installation depuis l'AUR avec $helper…"
    if "$helper" -S --needed --noconfirm jellyfin-mpv-shim; then
      manifest_add "mpv-shim aur"
      return 0
    fi
  fi
  if have flatpak; then
    echo "Installation depuis Flathub…"
    if ! flatpak remotes --user 2>/dev/null | grep -q "^flathub"; then
      flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo &&
        manifest_add "flathub-remote user"
    fi
    if flatpak install --user -y --noninteractive flathub "$FLATPAK_ID"; then
      manifest_add "mpv-shim flatpak"
      return 0
    fi
  fi
  echo "Installation avec pipx…"
  case "$PM" in
    pacman) pkg_install mpv python-pipx tk ;;
    apt) pkg_install mpv libmpv-dev pipx python3-tk ;;
    dnf) pkg_install mpv mpv-libs pipx python3-tkinter ;;
    zypper) pkg_install mpv python3-pipx python3-tk ;;
  esac || return 1
  have pipx || return 1
  pipx install 'jellyfin-mpv-shim[all]' || return 1
  manifest_add "mpv-shim pipx"
}
