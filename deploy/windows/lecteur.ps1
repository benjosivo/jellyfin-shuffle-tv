# Prépare ce PC comme écran de lecture : installe Jellyfin MPV Shim s'il manque, le fait démarrer
# à l'ouverture de session et le lance. Le serveur l'assemble avec mpv-shim.ps1 (/lecteur.ps1) :
#   irm http://<serveur>:8787/lecteur.ps1 | iex
# Rien d'autre n'est installé (ni Node.js, ni l'application) : l'instance du serveur pilote cet écran.

$ErrorActionPreference = 'Stop'

Step 'Jellyfin MPV Shim'
$installed = Find-MpvShim
if ($installed) {
  Ok "Déjà installé : $($installed.DisplayName)"
} elseif (Install-MpvShim) {
  Ok 'Jellyfin MPV Shim installé.'
} else {
  throw "Installation non détectée : installer MPV Shim à la main (https://github.com/jellyfin/jellyfin-mpv-shim/releases)."
}

$shortcut = Find-MpvShimShortcut
if (-not $shortcut) { throw 'Raccourci de MPV Shim introuvable : le lancer à la main depuis le menu Démarrer.' }

# Démarrage automatique, s'il n'est pas déjà prévu.
$startupDir = [Environment]::GetFolderPath('Startup')
if (-not (Get-ChildItem $startupDir -Filter '*MPV Shim*.lnk' -ErrorAction SilentlyContinue)) {
  Copy-Item $shortcut.FullName (Join-Path $startupDir $shortcut.Name) -Force
  Ok 'MPV Shim démarre automatiquement.'
} else {
  Ok 'MPV Shim démarre déjà automatiquement.'
}

if (-not (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Jellyfin MPV Shim*' })) {
  Start-Process $shortcut.FullName
}

Step 'Suite'
Write-Host "Dans MPV Shim : ajouter le serveur Jellyfin avec le même utilisateur que l'application."
Write-Host "Cet écran apparaît ensuite dans l'application : « Lire sur… »."
