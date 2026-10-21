#!/usr/bin/env bash
# Installation de « Jellyfin en boucle » sur Linux (systemd).
#
#   deploy/linux/install.sh            installation interactive
#   deploy/linux/install.sh --yes      répond oui à toutes les questions
#   deploy/linux/install.sh --no-mpv-shim --no-open-ui
#
# Étapes : Node.js, Jellyfin MPV Shim, build, service systemd utilisateur, pare-feu,
# ouverture de la page QR code au login, repérage de l'ancien script fish.
# Ce script ne supprime rien.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-8787}"
USER_NAME="${USER:-$(id -un)}"
ASSUME_YES=0
INSTALL_MPV_SHIM=1
OPEN_UI=1
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --no-mpv-shim) INSTALL_MPV_SHIM=0 ;;
    --no-open-ui) OPEN_UI=0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done

FLATPAK_ID="com.github.iwalton3.jellyfin-mpv-shim"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
ask() {
  [[ $ASSUME_YES -eq 1 ]] && return 0
  local answer
  read -r -p "$1 [O/n] " answer || return 1
  [[ -z "$answer" || "$answer" =~ ^[oOyY] ]]
}

[[ $EUID -eq 0 ]] && die "Lancer ce script avec l'utilisateur de la session (sans sudo) : il demandera sudo si besoin."
have systemctl || die "systemd est nécessaire (systemctl introuvable)."

# --- Gestionnaire de paquets --------------------------------------------------------

PM=""
if have pacman; then PM=pacman
elif have apt-get; then PM=apt
elif have dnf; then PM=dnf
elif have zypper; then PM=zypper
fi

pkg_install() {
  case "$PM" in
    pacman) sudo pacman -S --needed --noconfirm "$@" ;;
    apt) sudo apt-get update && sudo apt-get install -y "$@" ;;
    dnf) sudo dnf install -y "$@" ;;
    zypper) sudo zypper --non-interactive install "$@" ;;
    *) return 1 ;;
  esac
}

# --- 1. Node.js -------------------------------------------------------------------------

step "Node.js"
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if ! have node || [[ $(node_major) -lt 20 ]]; then
  warn "Node.js 20 ou plus est requis (trouvé : $(node --version 2>/dev/null || echo aucun))."
  if [[ -n "$PM" ]] && ask "Installer Node.js avec $PM ?"; then
    pkg_install nodejs npm || die "Installation de Node.js impossible."
  fi
  if ! have node || [[ $(node_major) -lt 20 ]]; then
    die "Installer Node.js ≥ 20 (https://nodejs.org ou NodeSource pour Debian/Ubuntu), puis relancer."
  fi
fi
have npm || die "npm introuvable (paquet « npm »)."
NODE_BIN="$(command -v node)"
ok "Node.js $(node --version) ($NODE_BIN)"

# --- 2. Jellyfin MPV Shim -------------------------------------------------------------

step "Jellyfin MPV Shim"
MPV_SHIM_CMD=""
detect_mpv_shim() {
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
  local helper=""
  have paru && helper=paru
  [[ -z "$helper" ]] && have yay && helper=yay
  if [[ "$PM" == pacman && -n "$helper" ]]; then
    echo "Installation depuis l'AUR avec $helper…"
    "$helper" -S --needed --noconfirm jellyfin-mpv-shim && return 0
  fi
  if have flatpak; then
    echo "Installation depuis Flathub…"
    flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
    flatpak install --user -y flathub "$FLATPAK_ID" && return 0
  fi
  echo "Installation avec pipx…"
  case "$PM" in
    pacman) pkg_install mpv python-pipx tk ;;
    apt) pkg_install mpv libmpv-dev pipx python3-tk ;;
    dnf) pkg_install mpv mpv-libs pipx python3-tkinter ;;
    zypper) pkg_install mpv python3-pipx python3-tk ;;
  esac
  have pipx || return 1
  pipx install 'jellyfin-mpv-shim[all]' && pipx ensurepath >/dev/null 2>&1 || true
  [[ -x "$HOME/.local/bin/jellyfin-mpv-shim" ]]
}

if detect_mpv_shim; then
  ok "Déjà installé : $MPV_SHIM_CMD"
elif [[ $INSTALL_MPV_SHIM -eq 1 ]] && ask "Jellyfin MPV Shim n'est pas installé. L'installer ?"; then
  if install_mpv_shim && detect_mpv_shim; then
    ok "Installé : $MPV_SHIM_CMD"
  else
    warn "Installation automatique impossible : voir https://github.com/jellyfin/jellyfin-mpv-shim#linux-installation"
  fi
else
  warn "MPV Shim non installé : la lecture ne pourra pas démarrer sans lui."
fi

if [[ -n "$MPV_SHIM_CMD" ]]; then
  # Démarrage automatique de MPV Shim à l'ouverture de session, s'il n'est pas déjà prévu.
  if ! grep -rqsi "jellyfin-mpv-shim" "$AUTOSTART_DIR" 2>/dev/null; then
    mkdir -p "$AUTOSTART_DIR"
    cat > "$AUTOSTART_DIR/jellyfin-mpv-shim.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jellyfin MPV Shim
Exec=$MPV_SHIM_CMD
X-GNOME-Autostart-enabled=true
EOF
    ok "Démarrage automatique de MPV Shim ajouté ($AUTOSTART_DIR/jellyfin-mpv-shim.desktop)."
  else
    ok "MPV Shim démarre déjà automatiquement."
  fi
fi

# --- 3. Build ---------------------------------------------------------------------------

step "Installation des dépendances et build"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
ok "Build terminé."

# --- 4. Service systemd utilisateur -----------------------------------------------------

step "Service systemd utilisateur"
mkdir -p "$SYSTEMD_DIR"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE_BIN|g" -e "s|__PORT__|$PORT|g" \
  "$APP_DIR/deploy/linux/jellyfin-office.service" > "$SYSTEMD_DIR/jellyfin-office.service"
systemctl --user daemon-reload
systemctl --user enable jellyfin-office.service >/dev/null
systemctl --user restart jellyfin-office.service
sleep 2
if systemctl --user is-active --quiet jellyfin-office.service; then
  ok "Service actif : $SYSTEMD_DIR/jellyfin-office.service"
else
  warn "Le service ne démarre pas : journalctl --user -u jellyfin-office -e"
fi

if have loginctl && [[ "$(loginctl show-user "$USER_NAME" -p Linger --value 2>/dev/null)" != "yes" ]]; then
  echo "Par défaut, le service démarre à l'ouverture de session (comme MPV Shim)."
  if [[ $ASSUME_YES -eq 0 ]] && ask "Le lancer aussi dès le démarrage du PC, sans session ouverte (linger) ?"; then
    sudo loginctl enable-linger "$USER_NAME" && ok "Linger activé."
  fi
fi

# --- 5. Pare-feu ------------------------------------------------------------------------

step "Pare-feu (accès depuis le téléphone)"
if have ufw && systemctl is-active --quiet ufw 2>/dev/null; then
  if ask "ufw est actif. Ouvrir le port $PORT/tcp (sudo) ?"; then
    sudo ufw allow "$PORT/tcp" comment "Jellyfin en boucle" && ok "Port ouvert (ufw)."
  fi
elif have firewall-cmd && systemctl is-active --quiet firewalld 2>/dev/null; then
  if ask "firewalld est actif. Ouvrir le port $PORT/tcp (sudo) ?"; then
    sudo firewall-cmd --permanent --add-port="$PORT/tcp" && sudo firewall-cmd --reload && ok "Port ouvert (firewalld)."
  fi
else
  ok "Aucun pare-feu actif détecté."
fi

# --- 6. Page QR code à l'ouverture de session --------------------------------------------

step "Page QR code au login"
if [[ $OPEN_UI -eq 1 ]]; then
  mkdir -p "$AUTOSTART_DIR"
  cat > "$AUTOSTART_DIR/jellyfin-en-boucle.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jellyfin en boucle
Comment=Affiche le QR code pour piloter la lecture depuis le téléphone
Exec=env PORT=$PORT $APP_DIR/deploy/linux/open-ui.sh
X-GNOME-Autostart-enabled=true
EOF
  ok "Ajoutée : $AUTOSTART_DIR/jellyfin-en-boucle.desktop (supprimer ce fichier pour la désactiver)."
else
  ok "Ignorée (--no-open-ui)."
fi

# --- 7. Ancien script fish ---------------------------------------------------------------

step "Ancien script fish"
found=0
while IFS= read -r file; do
  warn "Lancement de l'ancien script trouvé dans : $file"
  found=1
done < <(grep -rlsi -e "the-office-random" -e "the office random" \
  "$AUTOSTART_DIR" "$SYSTEMD_DIR" "${XDG_CONFIG_HOME:-$HOME/.config}/fish" \
  "$HOME/.local/share/applications" 2>/dev/null | grep -v "jellyfin-en-boucle.desktop" || true)
if crontab -l 2>/dev/null | grep -qi "office-random"; then
  warn "Lancement de l'ancien script trouvé dans la crontab (crontab -e)."
  found=1
fi
if [[ $found -eq 1 ]]; then
  echo "  → Le désactiver, sinon les deux pilotent MPV Shim en même temps."
  echo "    (fichier .desktop : le supprimer ; unité systemd : systemctl --user disable --now <nom>)"
else
  ok "Aucun lancement automatique de l'ancien script trouvé."
fi

# --- Fin ----------------------------------------------------------------------------------

step "Terminé"
echo "Interface : http://localhost:$PORT/  (le QR code pour le téléphone s'y affiche)"
echo "Journal   : journalctl --user -u jellyfin-office -f"
if command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  if ask "Ouvrir l'interface maintenant ?"; then
    (xdg-open "http://localhost:$PORT/?qr=1" >/dev/null 2>&1 &)
  fi
fi
