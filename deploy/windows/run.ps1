# Lance le serveur Node et le relance s'il s'arrête sur une erreur (équivalent de Restart=on-failure).
# Démarré sans fenêtre par run-hidden.vbs (tâche planifiée « Jellyfin en boucle »).
param([int]$Port = 8787)

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LogDir = Join-Path $env:APPDATA 'jellyfin-office'
$Log = Join-Path $LogDir 'service.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $AppDir
$env:PORT = "$Port"
$env:HOST = '0.0.0.0'
$env:NODE_ENV = 'production'

while ($true) {
  # Le journal est tronqué au-delà de 5 Mo pour ne pas grossir indéfiniment.
  if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 5MB) { Move-Item $Log "$Log.old" -Force }
  Add-Content $Log "----- $(Get-Date -Format s) démarrage -----" -Encoding UTF8
  # Redirection par cmd : sortie UTF-8 brute (la redirection PowerShell 5.1 écrirait de l'UTF-16).
  & cmd.exe /d /c "node dist\server\index.js >> `"$Log`" 2>&1"
  if ($LASTEXITCODE -eq 0) { break }
  Add-Content $Log "----- arrêt (code $LASTEXITCODE), relance dans 5 s -----" -Encoding UTF8
  Start-Sleep -Seconds 5
}
