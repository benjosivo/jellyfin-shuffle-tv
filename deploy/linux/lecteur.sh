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

# Consignes de connexion. SERVER_URL (adresse de l'instance) est ajouté en tête par /lecteur.sh,
# ou fixé par install.sh : le serveur Jellyfin et l'utilisateur y sont lus dans /api/setup.
step "Suite"
jellyfin_url="" jellyfin_user=""
if [[ -n "${SERVER_URL:-}" ]] && have curl; then
  setup_json="$(curl -fsS -m 5 "${SERVER_URL%/}/api/setup" 2>/dev/null || true)"
  # Premières occurrences : les champs de premier niveau viennent avant la liste des candidats.
  jellyfin_url="$(grep -o '"serverUrl":"[^"]*"' <<<"$setup_json" | head -n 1 | cut -d '"' -f 4 || true)"
  jellyfin_user="$(grep -o '"userName":"[^"]*"' <<<"$setup_json" | head -n 1 | cut -d '"' -f 4 || true)"
fi
echo "1. Dans MPV Shim (fenêtre de connexion au premier lancement, sinon son icône près de l'horloge) :"
if [[ -n "$jellyfin_url" && -n "$jellyfin_user" ]]; then
  echo "   ajouter le serveur Jellyfin $jellyfin_url, utilisateur « $jellyfin_user » (et son mot de passe)."
else
  echo "   ajouter le même serveur Jellyfin et le même utilisateur que l'application."
fi
echo "2. Ouvrir l'application${SERVER_URL:+ ($SERVER_URL)}, puis « Lire sur… » : choisir cet écran."
