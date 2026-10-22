#!/usr/bin/env bash
# Mise à jour de « Jellyfin en boucle » depuis le dépôt git (sans sudo).
#
#   deploy/linux/update.sh
#
# Récupère la branche suivie (fast-forward uniquement), réinstalle les dépendances si
# package.json ou package-lock.json ont changé, recompile, puis relance le service s'il tournait.
# En cas d'échec de l'installation ou du build, l'ancienne version est rétablie.
# Ne fait rien si le dossier contient des modifications locales ou des commits non publiés.
# Lancé chaque jour et à l'ouverture de session par jellyfin-office-update.timer.
# Journal : journalctl --user -u jellyfin-office-update

set -uo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

log() { printf '%s\n' "$*"; }

build() {
  cd "$APP_DIR" || return 1
  if [[ "$1" -eq 1 ]]; then npm ci --no-audit --no-fund || return 1; fi
  npm run build
}

# Tout le script est dans cette fonction, appelée en dernière ligne : git peut remplacer ce fichier
# pendant le `merge` sans que bash n'en lise la suite (il lit son fichier au fur et à mesure).
main() {
  # Une seule mise à jour à la fois (timer + lancement manuel).
  mkdir -p "$CONFIG_DIR"
  exec 9> "$CONFIG_DIR/update.lock"
  if have flock; then
    flock -n 9 || { log "Une mise à jour est déjà en cours."; return 0; }
  fi

  [[ -d "$APP_DIR/.git" ]] || { log "Pas de dépôt git dans $APP_DIR : mise à jour impossible."; return 0; }
  have git || { log "git est introuvable."; return 1; }
  local upstream old new
  upstream="$(git -C "$APP_DIR" rev-parse --abbrev-ref '@{u}' 2>/dev/null)" ||
    { log "La branche courante ne suit aucune branche distante : rien à mettre à jour."; return 0; }

  git -C "$APP_DIR" fetch --quiet || { log "git fetch a échoué (réseau ?)."; return 1; }
  old="$(git -C "$APP_DIR" rev-parse HEAD)"
  new="$(git -C "$APP_DIR" rev-parse '@{u}')"
  if [[ "$old" == "$new" ]]; then
    log "À jour (${old:0:7}, $upstream)."
    return 0
  fi
  if [[ "$(git -C "$APP_DIR" merge-base HEAD '@{u}')" != "$old" ]]; then
    log "Des commits locaux ne sont pas publiés sur $upstream : mise à jour ignorée."
    return 0
  fi
  if [[ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]]; then
    log "Des fichiers suivis ont été modifiés localement : mise à jour ignorée."
    return 0
  fi

  local deps_changed=0
  git -C "$APP_DIR" diff --name-only "$old" "$new" | grep -qE '^package(-lock)?\.json$' && deps_changed=1
  [[ -d "$APP_DIR/node_modules" ]] || deps_changed=1
  log "Mise à jour ${old:0:7} -> ${new:0:7} ($upstream)."

  # Relancé seulement s'il tournait : un service arrêté volontairement le reste.
  local was_active=0
  systemctl --user is-active --quiet "$UNIT_NAME" && was_active=1
  [[ $was_active -eq 1 ]] && systemctl --user stop "$UNIT_NAME"

  local status=0
  if git -C "$APP_DIR" merge --ff-only '@{u}' >/dev/null && build "$deps_changed"; then
    log "Build terminé."
  else
    status=1
    log "Échec de la mise à jour : retour à la version précédente (${old:0:7})."
    git -C "$APP_DIR" reset --hard "$old" >/dev/null && build 1 ||
      log "Le retour arrière a échoué aussi."
  fi
  if [[ $was_active -eq 1 ]]; then
    systemctl --user start "$UNIT_NAME" && log "Service relancé."
  fi
  return $status
}

main
exit $?
