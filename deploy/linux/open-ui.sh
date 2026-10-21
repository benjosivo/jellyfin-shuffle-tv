#!/usr/bin/env bash
# Ouvre la page QR code dans le navigateur à l'ouverture de session,
# une fois que le service répond (au plus 60 s d'attente).
PORT="${PORT:-8787}"
URL="http://localhost:${PORT}"

for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    exec xdg-open "${URL}/?qr=1"
  fi
  sleep 1
done
echo "Jellyfin en boucle ne répond pas sur ${URL}" >&2
exit 1
