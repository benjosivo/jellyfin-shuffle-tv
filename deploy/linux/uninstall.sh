#!/usr/bin/env bash
# Désinstallation complète de « Jellyfin en boucle » sur Linux.
#
#   deploy/linux/uninstall.sh                     tout retirer (une confirmation)
#   deploy/linux/uninstall.sh --yes               sans confirmation
#   deploy/linux/uninstall.sh --keep-third-party  garder MPV Shim, Node.js et les paquets installés
#   deploy/linux/uninstall.sh --remove-folder     supprimer aussi ce dossier (le code source)
#
# Retire : service, démarrages automatiques, règle de pare-feu, linger, et tout le dossier de
# configuration (jeton, identifiants, historique, journaux). Les jetons Jellyfin sont d'abord
# révoqués côté serveur. MPV Shim, Node.js et les paquets ne sont retirés que si c'est
# l'installation qui les avait ajoutés (manifeste) ; ce qui existait avant reste en place.
# Peut être relancé sans risque : chaque étape ignore ce qui est déjà absent.

set -uo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ASSUME_YES=0
KEEP_THIRD_PARTY=0
REMOVE_FOLDER=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --keep-third-party) KEEP_THIRD_PARTY=1 ;;
    --remove-folder) REMOVE_FOLDER=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] && die "Lancer ce script avec l'utilisateur de la session (sans sudo) : il demandera sudo si besoin."

has_manifest=0
[[ -f "$MANIFEST" ]] && has_manifest=1
mpv_shim_via="$(manifest_values mpv-shim | head -n1)"
[[ $KEEP_THIRD_PARTY -eq 1 ]] && mpv_shim_via=""

# --- Résumé et confirmation -----------------------------------------------------------------

step "Désinstallation de Jellyfin en boucle"
echo "Seront supprimés :"
echo "  - le service jellyfin-office, son minuteur de mise à jour, l'icône d'état et les démarrages automatiques"
echo "  - $CONFIG_DIR (jeton Jellyfin, identifiants, historique, journaux), après révocation du jeton"
echo "  - node_modules et dist dans $APP_DIR"
[[ $REMOVE_FOLDER -eq 1 ]] && echo "  - le dossier $APP_DIR lui-même"
if [[ $has_manifest -eq 1 ]]; then
  [[ -n "$(manifest_values firewall)" ]] && echo "  - la règle de pare-feu ajoutée"
  if [[ $KEEP_THIRD_PARTY -eq 0 ]]; then
    [[ -n "$mpv_shim_via" ]] && echo "  - Jellyfin MPV Shim ($mpv_shim_via) et sa configuration"
    pkgs="$(manifest_values package | tr '\n' ' ')"
    [[ -n "$pkgs" ]] && echo "  - les paquets installés par l'installation : $pkgs"
  fi
else
  warn "Aucun manifeste d'installation : MPV Shim, Node.js et les paquets système seront laissés en place."
fi
if [[ $ASSUME_YES -eq 0 ]]; then
  read -r -p "Continuer ? [o/N] " answer || answer=""
  [[ "$answer" =~ ^[oOyY] ]] || { echo "Annulé."; exit 0; }
fi

# --- 1. Révocation des jetons Jellyfin --------------------------------------------------------

step "Révocation des jetons Jellyfin"
mpv_shim_configs=()
case "$mpv_shim_via" in
  aur|pipx) mpv_shim_configs=("$CONFIG_HOME/jellyfin-mpv-shim") ;;
  flatpak) mpv_shim_configs=("$HOME/.var/app/$FLATPAK_ID/config/jellyfin-mpv-shim") ;;
esac
if have node && [[ -f "$APP_DIR/dist/server/cli/uninstall.js" ]]; then
  revoke_args=(--config-dir "$CONFIG_DIR")
  for dir in "${mpv_shim_configs[@]}"; do revoke_args+=(--mpv-shim-config "$dir"); done
  node "$APP_DIR/dist/server/cli/uninstall.js" "${revoke_args[@]}" || warn "Révocation interrompue."
else
  warn "Node.js ou le build est absent : jetons non révoqués côté serveur (ils sont quand même effacés de ce PC)."
fi

# --- 2. Service -------------------------------------------------------------------------------

step "Service"
if have systemctl; then
  # Le minuteur d'abord : une mise à jour en cours relancerait le service qu'on arrête.
  systemctl --user disable --now jellyfin-office-update.timer >/dev/null 2>&1 || true
  systemctl --user stop jellyfin-office-update.service >/dev/null 2>&1 || true
  systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
fi
rm -f "$SYSTEMD_DIR/$UNIT_NAME" "$SYSTEMD_DIR/jellyfin-office-update.service" "$SYSTEMD_DIR/jellyfin-office-update.timer"
if have systemctl; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user reset-failed "$UNIT_NAME" jellyfin-office-update.service >/dev/null 2>&1 || true
fi
ok "Service arrêté et supprimé."

# --- 3. Fichiers ajoutés (démarrages automatiques…) -----------------------------------------

step "Démarrages automatiques et icône d'état"
pkill -f "$APP_DIR/dist/server/tray/linux.js" >/dev/null 2>&1 || true
rm -f "$AUTOSTART_DIR/jellyfin-en-boucle.desktop" "$AUTOSTART_DIR/jellyfin-en-boucle-tray.desktop"
while IFS= read -r file; do
  [[ -n "$file" ]] && rm -f "$file"
done < <(manifest_values file)
ok "Supprimés."

# --- 4. Pare-feu et linger -------------------------------------------------------------------

step "Pare-feu"
while IFS=' ' read -r tool port; do
  case "$tool" in
    ufw) sudo ufw delete allow "$port/tcp" >/dev/null 2>&1 && ok "Port $port refermé (ufw)." ;;
    firewalld)
      sudo firewall-cmd --permanent --remove-port="$port/tcp" >/dev/null 2>&1 && sudo firewall-cmd --reload >/dev/null 2>&1 &&
        ok "Port $port refermé (firewalld)." ;;
  esac
done < <(manifest_values firewall)
[[ -z "$(manifest_values firewall)" ]] && ok "Aucune règle ajoutée par l'installation."

linger_user="$(manifest_values linger | head -n1)"
if [[ -n "$linger_user" ]] && have loginctl; then
  sudo loginctl disable-linger "$linger_user" && ok "Linger désactivé."
fi

# --- 5. Jellyfin MPV Shim ----------------------------------------------------------------------

step "Jellyfin MPV Shim"
if [[ -n "$mpv_shim_via" ]]; then
  pkill -f "jellyfin-mpv-shim|jellyfin_mpv_shim" >/dev/null 2>&1 || true
  case "$mpv_shim_via" in
    aur) pkg_present jellyfin-mpv-shim && sudo pacman -Rns --noconfirm jellyfin-mpv-shim ;;
    flatpak)
      flatpak kill "$FLATPAK_ID" >/dev/null 2>&1 || true
      flatpak uninstall --user -y --noninteractive --delete-data "$FLATPAK_ID" >/dev/null 2>&1 || true
      flatpak uninstall --user -y --noninteractive --unused >/dev/null 2>&1 || true
      if [[ -n "$(manifest_values flathub-remote)" ]] && [[ -z "$(flatpak list --user --app --columns=origin 2>/dev/null | grep -x flathub)" ]]; then
        flatpak remote-delete --user flathub >/dev/null 2>&1 || true
      fi ;;
    pipx) have pipx && pipx uninstall jellyfin-mpv-shim >/dev/null 2>&1 ;;
  esac
  rm -rf "$CONFIG_HOME/jellyfin-mpv-shim" "$HOME/.var/app/$FLATPAK_ID" "$HOME/.cache/jellyfin-mpv-shim"
  ok "MPV Shim et sa configuration supprimés."
elif [[ $KEEP_THIRD_PARTY -eq 1 ]]; then
  ok "Conservé (--keep-third-party)."
else
  ok "Pas installé par l'installation : laissé en place."
fi

# --- 6. Paquets système ajoutés ------------------------------------------------------------------

step "Paquets ajoutés par l'installation"
if [[ $KEEP_THIRD_PARTY -eq 1 ]]; then
  ok "Conservés (--keep-third-party)."
else
  mapfile -t packages < <(manifest_values package)
  # Ordre inverse de l'installation (npm avant nodejs, par exemple).
  for ((i = ${#packages[@]} - 1; i >= 0; i--)); do
    pkg="${packages[i]}"
    pkg_present "$pkg" || continue
    if pkg_remove "$pkg" >/dev/null 2>&1; then
      ok "Paquet $pkg retiré."
    else
      warn "Paquet $pkg conservé (utilisé par un autre programme ?)."
    fi
  done
  removed_repo=0
  while IFS= read -r file; do
    [[ -n "$file" && -e "$file" ]] && sudo rm -f "$file" && removed_repo=1
  done < <(manifest_values sysfile)
  [[ $removed_repo -eq 1 && "$PM" == apt ]] && sudo apt-get update >/dev/null 2>&1
  [[ ${#packages[@]} -eq 0 && $removed_repo -eq 0 ]] && ok "Aucun."
fi

# --- 7. Fichiers de l'application ----------------------------------------------------------------

step "Fichiers de l'application"
rm -rf "$APP_DIR/node_modules" "$APP_DIR/dist"
rm -rf "$CONFIG_DIR"
# Dossiers créés pour nos fichiers : retirés seulement s'ils sont désormais vides.
rmdir "$SYSTEMD_DIR" "$CONFIG_HOME/systemd" "$AUTOSTART_DIR" 2>/dev/null || true
ok "Configuration et secrets effacés ($CONFIG_DIR)."
if [[ $REMOVE_FOLDER -eq 1 ]]; then
  cd / && rm -rf "$APP_DIR"
  ok "Dossier $APP_DIR supprimé."
else
  ok "Le dossier $APP_DIR (code source, sans secret) est conservé : deploy/linux/install.sh pour réinstaller."
fi

step "Désinstallation terminée"
