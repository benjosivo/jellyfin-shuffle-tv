# Ouvre la page QR code dans le navigateur une fois que le service répond (au plus 60 s d'attente).
param([int]$Port = 8787)

$url = "http://localhost:$Port"
for ($i = 0; $i -lt 60; $i++) {
  try {
    Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
    Start-Process "$url/?qr=1"
    exit 0
  } catch {
    Start-Sleep -Seconds 1
  }
}
exit 1
