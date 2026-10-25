#!/usr/bin/env bash
# Installation de « Jellyfin en boucle » sur Linux (systemd).
#
#   deploy/linux/install.sh                 installe tout sans poser de question (sudo est demandé si besoin)
#   deploy/linux/install.sh --ask           demande confirmation à chaque étape
#   deploy/linux/install.sh --no-mpv-shim --no-open-ui --no-tray --no-auto-update
#
# Étapes : Node.js, Jellyfin MPV Shim, build, service systemd utilisateur, mise à jour automatique,
# pare-feu, ouverture de la page QR code au login, icône d'état, repérage de l'ancien script fish.
# Tout ce qui est ajouté est noté pour que deploy/linux/uninstall.sh le retire proprement.
# Peut être relancé autant de fois que voulu.

set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PORT="${PORT:-8787}"
ASSUME_YES=1
INSTALL_MPV_SHIM=1
OPEN_UI=1
TRAY=1
AUTO_UPDATE=1
for arg in "$@"; do
  case "$arg" in
    --ask) ASSUME_YES=0 ;;
    -y|--yes) ASSUME_YES=1 ;;
    --no-mpv-shim) INSTALL_MPV_SHIM=0 ;;
    --no-open-ui) OPEN_UI=0 ;;
    --no-tray) TRAY=0 ;;
    --no-auto-update) AUTO_UPDATE=0 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done

ask() {
  [[ $ASSUME_YES -eq 1 ]] && return 0
  local answer
  read -r -p "$1 [O/n] " answer || return 1
  [[ -z "$answer" || "$answer" =~ ^[oOyY] ]]
}

[[ $EUID -eq 0 ]] && die "Lancer ce script avec l'utilisateur de la session (sans sudo) : il demandera sudo si besoin."
have systemctl || die "systemd est nécessaire (systemctl introuvable)."
mkdir -p "$CONFIG_DIR"
manifest_add "port $PORT"

# --- 1. Node.js -------------------------------------------------------------------------

step "Node.js"
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Debian/Ubuntu fournissent souvent un Node.js trop ancien : dépôt officiel NodeSource.
install_node_nodesource() {
  pkg_install curl ca-certificates || return 1
  local setup before
  setup="$(mktemp)"
  before="$(ls /etc/apt/sources.list.d/nodesource.* /etc/apt/keyrings/nodesource.* 2>/dev/null || true)"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "$setup" || return 1
  sudo -E bash "$setup" || return 1
  rm -f "$setup"
  local file
  for file in /etc/apt/sources.list.d/nodesource.* /etc/apt/keyrings/nodesource.* /usr/share/keyrings/nodesource.*; do
    [[ -e "$file" ]] || continue
    grep -qxF "$file" <<<"$before" || manifest_add "sysfile $file"
  done
  local had_node=0
  pkg_present nodejs && had_node=1
  sudo apt-get install -y nodejs || return 1
  [[ $had_node -eq 1 ]] || manifest_add "package nodejs"
}

if ! have node || [[ $(node_major) -lt 20 ]]; then
  warn "Node.js 20 ou plus est requis (trouvé : $(node --version 2>/dev/null || echo aucun))."
  if [[ -n "$PM" ]] && ask "Installer Node.js ?"; then
    if [[ "$PM" == apt ]]; then
      install_node_nodesource || die "Installation de Node.js impossible."
    else
      pkg_install nodejs npm || die "Installation de Node.js impossible."
    fi
    hash -r
  fi
  if ! have node || [[ $(node_major) -lt 20 ]]; then
    die "Installer Node.js ≥ 20 (https://nodejs.org), puis relancer."
  fi
fi
have npm || pkg_install npm || die "npm introuvable (paquet « npm »)."
NODE_BIN="$(command -v node)"
ok "Node.js $(node --version) ($NODE_BIN)"

# --- 2. Jellyfin MPV Shim -------------------------------------------------------------

step "Jellyfin MPV Shim"
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
  # Démarrage automatique de MPV Shim à l'ouverture de session, s'il n'est pas déjà prévu ailleurs.
  shim_desktop="$AUTOSTART_DIR/jellyfin-mpv-shim.desktop"
  if manifest_has "file $shim_desktop" || ! grep -rqsi "jellyfin-mpv-shim" "$AUTOSTART_DIR" 2>/dev/null; then
    mkdir -p "$AUTOSTART_DIR"
    cat > "$shim_desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jellyfin MPV Shim
Exec=$MPV_SHIM_CMD
X-GNOME-Autostart-enabled=true
EOF
    manifest_add "file $shim_desktop"
    ok "MPV Shim démarre automatiquement ($shim_desktop)."
  else
    ok "MPV Shim démarre déjà automatiquement."
  fi
  # Premier lancement, pour pouvoir le connecter tout de suite (assistant de l'interface).
  if ! pgrep -f "jellyfin-mpv-shim|jellyfin_mpv_shim" >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    (nohup $MPV_SHIM_CMD >/dev/null 2>&1 &)
  fi
fi

# --- 3. Build ---------------------------------------------------------------------------

step "Installation des dépendances et build"
# Une version précédente peut tourner : on l'arrête pendant la mise à jour des fichiers.
systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || true
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
ok "Build terminé."

# --- 3b. Compresseur audio ----------------------------------------------------------------

step "Compresseur audio (MPV Shim)"
if [[ -n "$MPV_SHIM_CMD" ]]; then
  shim_config="$CONFIG_HOME/jellyfin-mpv-shim"
  [[ "$MPV_SHIM_CMD" == flatpak* ]] && shim_config="$HOME/.var/app/$FLATPAK_ID/config/jellyfin-mpv-shim"
  # Activé seulement si rien n'a été décidé : un réglage ou un filtre existant est conservé.
  node "$APP_DIR/dist/server/cli/audio.js" enable-default --dir "$shim_config"
else
  ok "Ignoré : MPV Shim non installé."
fi

# --- 4. Service systemd utilisateur -----------------------------------------------------

step "Service systemd utilisateur"
mkdir -p "$SYSTEMD_DIR"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE_BIN|g" -e "s|__PORT__|$PORT|g" \
  -e "s|__CONFIG_DIR__|$CONFIG_DIR|g" \
  "$APP_DIR/deploy/linux/jellyfin-office.service" > "$SYSTEMD_DIR/$UNIT_NAME"
manifest_add "file $SYSTEMD_DIR/$UNIT_NAME"
systemctl --user daemon-reload
systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true
systemctl --user enable "$UNIT_NAME" >/dev/null
systemctl --user restart "$UNIT_NAME"
sleep 2
if systemctl --user is-active --quiet "$UNIT_NAME"; then
  ok "Service actif : $SYSTEMD_DIR/$UNIT_NAME"
else
  warn "Le service ne démarre pas : journalctl --user -u jellyfin-office -e"
fi

if [[ $ASSUME_YES -eq 0 ]] && have loginctl && [[ "$(loginctl show-user "$USER_NAME" -p Linger --value 2>/dev/null)" != "yes" ]]; then
  echo "Par défaut, le service démarre à l'ouverture de session (comme MPV Shim)."
  if ask "Le lancer aussi dès le démarrage du PC, sans session ouverte (linger) ?"; then
    sudo loginctl enable-linger "$USER_NAME" && manifest_add "linger $USER_NAME" && ok "Linger activé."
  fi
fi

# --- 5. Mise à jour automatique ---------------------------------------------------------

step "Mise à jour automatique"
UPDATE_UNIT="jellyfin-office-update.service"
UPDATE_TIMER="jellyfin-office-update.timer"
if [[ $AUTO_UPDATE -eq 0 ]]; then
  systemctl --user disable --now "$UPDATE_TIMER" >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_DIR/$UPDATE_UNIT" "$SYSTEMD_DIR/$UPDATE_TIMER"
  systemctl --user daemon-reload
  ok "Ignorée (--no-auto-update) : lancer deploy/linux/update.sh à la main."
elif ! have git || ! upstream="$(git -C "$APP_DIR" rev-parse --abbrev-ref '@{u}' 2>/dev/null)"; then
  warn "Le dossier n'est pas un dépôt git suivant une branche distante : mise à jour automatique non installée."
else
  for unit in "$UPDATE_UNIT" "$UPDATE_TIMER"; do
    sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE_DIR__|$(dirname "$NODE_BIN")|g" -e "s|__CONFIG_DIR__|$CONFIG_DIR|g"       "$APP_DIR/deploy/linux/$unit" > "$SYSTEMD_DIR/$unit"
    manifest_add "file $SYSTEMD_DIR/$unit"
  done
  systemctl --user daemon-reload
  systemctl --user enable --now "$UPDATE_TIMER" >/dev/null
  ok "Minuteur actif (suit $upstream, tous les jours vers 4 h et au démarrage) : journalctl --user -u jellyfin-office-update"
fi

# --- 6. Pare-feu ------------------------------------------------------------------------

step "Pare-feu (accès depuis le téléphone)"
if have ufw && systemctl is-active --quiet ufw 2>/dev/null; then
  if manifest_has "firewall ufw $PORT" || ! sudo ufw status 2>/dev/null | grep -qE "^$PORT/tcp[[:space:]]"; then
    if ask "Ouvrir le port $PORT/tcp dans ufw ?"; then
      sudo ufw allow "$PORT/tcp" comment "Jellyfin en boucle" >/dev/null && manifest_add "firewall ufw $PORT" &&
        ok "Port $PORT ouvert (ufw)."
    fi
  else
    ok "Port $PORT déjà ouvert dans ufw."
  fi
elif have firewall-cmd && systemctl is-active --quiet firewalld 2>/dev/null; then
  if manifest_has "firewall firewalld $PORT" || ! sudo firewall-cmd --query-port="$PORT/tcp" >/dev/null 2>&1; then
    if ask "Ouvrir le port $PORT/tcp dans firewalld ?"; then
      sudo firewall-cmd --permanent --add-port="$PORT/tcp" >/dev/null && sudo firewall-cmd --reload >/dev/null &&
        manifest_add "firewall firewalld $PORT" && ok "Port $PORT ouvert (firewalld)."
    fi
  else
    ok "Port $PORT déjà ouvert dans firewalld."
  fi
else
  ok "Aucun pare-feu actif détecté."
fi

# --- 7. Page QR code à l'ouverture de session --------------------------------------------

step "Page QR code au login"
ui_desktop="$AUTOSTART_DIR/jellyfin-en-boucle.desktop"
if [[ $OPEN_UI -eq 1 ]]; then
  mkdir -p "$AUTOSTART_DIR"
  cat > "$ui_desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jellyfin en boucle
Comment=Affiche le QR code pour piloter la lecture depuis le téléphone
Exec=env PORT=$PORT $APP_DIR/deploy/linux/open-ui.sh
X-GNOME-Autostart-enabled=true
EOF
  manifest_add "file $ui_desktop"
  ok "Ajoutée : $ui_desktop"
else
  rm -f "$ui_desktop"
  ok "Ignorée (--no-open-ui)."
fi

# --- 8. Icône d'état dans la zone de notification ---------------------------------------------

step "Icône d'état (zone de notification)"
tray_script="$APP_DIR/dist/server/tray/linux.js"
tray_desktop="$AUTOSTART_DIR/jellyfin-en-boucle-tray.desktop"
pkill -f "$tray_script" >/dev/null 2>&1 || true
if [[ $TRAY -eq 1 ]]; then
  mkdir -p "$AUTOSTART_DIR"
  cat > "$tray_desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jellyfin en boucle (icône)
Comment=Icône d'état près de l'horloge : vert = lecture, orange = problème, rouge = arrêté
Exec=$NODE_BIN $tray_script --port $PORT
X-GNOME-Autostart-enabled=true
EOF
  manifest_add "file $tray_desktop"
  if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    (nohup "$NODE_BIN" "$tray_script" --port "$PORT" >/dev/null 2>&1 &)
  fi
  ok "Affichée près de l'horloge (vert = lecture, orange = problème, rouge = arrêté)."
  if [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]]; then
    warn "GNOME n'affiche ces icônes qu'avec l'extension « AppIndicator » (paquet gnome-shell-extension-appindicator)."
  fi
else
  rm -f "$tray_desktop"
  ok "Ignorée (--no-tray)."
fi

# --- 9. Ancien script fish ---------------------------------------------------------------

step "Ancien script fish"
found=0
while IFS= read -r file; do
  warn "Lancement de l'ancien script trouvé dans : $file"
  found=1
done < <(grep -rlsi -e "the-office-random" -e "the office random" \
  "$AUTOSTART_DIR" "$SYSTEMD_DIR" "$CONFIG_HOME/fish" \
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
echo "Interface      : http://localhost:$PORT/  (le QR code pour le téléphone s'y affiche)"
echo "Journal        : journalctl --user -u jellyfin-office -f"
echo "Désinstaller   : $APP_DIR/deploy/linux/uninstall.sh"
if [[ $OPEN_UI -eq 1 ]] && have xdg-open && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  (env PORT="$PORT" "$APP_DIR/deploy/linux/open-ui.sh" >/dev/null 2>&1 &)
fi
