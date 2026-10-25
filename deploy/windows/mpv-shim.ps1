# Installation de Jellyfin MPV Shim sous Windows. Chargé par common.ps1 (installation complète) et
# assemblé avec lecteur.ps1 par le serveur (/lecteur.ps1, exécuté par « iex ») : ne pas utiliser
# $PSScriptRoot ni le manifeste d'installation ici.

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "!   $text" -ForegroundColor Yellow }

function Find-MpvShim {
  $keys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  return Get-ItemProperty $keys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*MPV Shim*' } | Select-Object -First 1
}

function Find-MpvShimShortcut {
  $menus = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
  return Get-ChildItem $menus -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*MPV Shim*' -and $_.Name -notlike '*uninst*' -and $_.Name -notlike '*désinst*' } |
    Select-Object -First 1
}

function Install-MpvShim {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $release = Invoke-RestMethod 'https://api.github.com/repos/jellyfin/jellyfin-mpv-shim/releases/latest' -Headers @{ 'User-Agent' = 'jellyfin-en-boucle' }
  $installers = @($release.assets | Where-Object { $_.name -match 'installer.*\.exe$' })
  $arm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'
  $asset = $installers | Where-Object { ($_.name -match 'arm64') -eq $arm } | Select-Object -First 1
  if (-not $asset) { $asset = $installers | Select-Object -First 1 }
  if (-not $asset) {
    Warn "Installeur introuvable dans la release $($release.tag_name) : https://github.com/jellyfin/jellyfin-mpv-shim/releases"
    return $false
  }
  $setup = Join-Path $env:TEMP $asset.name
  Write-Host "Téléchargement de $($asset.name)…"
  Invoke-WebRequest $asset.browser_download_url -OutFile $setup -UseBasicParsing
  # Installeur Inno Setup : installation silencieuse ; repli sur l'installation normale si elle échoue.
  $process = Start-Process $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/ALLUSERS' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    Warn "Installation silencieuse échouée (code $($process.ExitCode)) : installeur ouvert normalement."
    Start-Process $setup -Wait
  }
  Remove-Item $setup -Force -ErrorAction SilentlyContinue
  return [bool](Find-MpvShim)
}
