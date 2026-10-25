# Prépare ce PC comme écran de lecture : installe Jellyfin MPV Shim s'il manque, le fait démarrer
# à l'ouverture de session et le lance. Le serveur l'assemble avec mpv-shim.sh (/lecteur.sh) :
#   curl -fsSL http://<serveur>:8787/lecteur.sh | bash
# Rien d'autre n'est installé (ni Node.js, ni l'application) : l'instance du serveur pilote cet écran.
# shellcheck shell=bash

set -euo pipefail

# Pas d'installation complète ici, donc pas de manifeste à tenir.
manifest_add() { :; }

[[ $EUID -eq 0 ]] && die "Lancer cette commande avec l'utilisateur de la session (sans sudo) : elle demandera sudo si besoin."

step "Jellyfin MPV Shim"
if detect_mpv_shim; then
  ok "Déjà installé : $MPV_SHIM_CMD"
elif install_mpv_shim && detect_mpv_shim; then
  ok "Installé : $MPV_SHIM_CMD"
else
  die "Installation automatique impossible : voir https://github.com/jellyfin/jellyfin-mpv-shim#linux-installation"
fi

# Démarrage automatique à l'ouverture de session, s'il n'est pas déjà prévu.
autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
if ! grep -rqsi "jellyfin-mpv-shim" "$autostart_dir" 2>/dev/null; then
  mkdir -p "$autostart_dir"
  cat > "$autostart_dir/jellyfin-mpv-shim.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jellyfin MPV Shim
Exec=$MPV_SHIM_CMD
X-GNOME-Autostart-enabled=true
EOF
  ok "MPV Shim démarre automatiquement."
else
  ok "MPV Shim démarre déjà automatiquement."
fi

# Premier lancement, pour pouvoir le connecter tout de suite. </dev/null : le script arrive par stdin.
if ! pgrep -f "jellyfin-mpv-shim|jellyfin_mpv_shim" >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  (nohup $MPV_SHIM_CMD >/dev/null 2>&1 </dev/null &)
fi

step "Suite"
echo "Dans MPV Shim : ajouter le serveur Jellyfin avec le même utilisateur que l'application."
echo "Cet écran apparaît ensuite dans l'application : « Lire sur… »."
