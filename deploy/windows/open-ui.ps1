# Ouvre la page QR code dans le navigateur une fois que le service répond (au plus 60 s d'attente).
#   -StartServer : (raccourci « Jellyfin en boucle ») relance d'abord le serveur s'il est arrêté,
#                  et signale le problème dans une fenêtre s'il ne répond toujours pas.
param(
  [int]$Port = 8787,
  [switch]$StartServer
)

$url = "http://localhost:$Port"

# Le serveur écoute en IPv4 : la vérification vise 127.0.0.1 (localhost peut désigner ::1).
function Test-Health {
  try {
    Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if ($StartServer -and -not (Test-Health)) {
  Start-ScheduledTask -TaskName 'Jellyfin en boucle' -ErrorAction SilentlyContinue
}

for ($i = 0; $i -lt 60; $i++) {
  if (Test-Health) {
    Start-Process "$url/?qr=1"
    exit 0
  }
  Start-Sleep -Seconds 1
}

if ($StartServer) {
  $log = Join-Path $env:APPDATA 'jellyfin-office\service.log'
  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.Popup("Jellyfin en boucle ne répond pas sur $url.`n`nJournal : $log", 0, 'Jellyfin en boucle', 48)
}
exit 1
