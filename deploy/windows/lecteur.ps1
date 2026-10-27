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

# Consignes de connexion. $ServerUrl (adresse de l'instance) est ajouté en tête par /lecteur.ps1,
# ou fixé par install.ps1 : le serveur Jellyfin et l'utilisateur y sont lus dans /api/setup.
Step 'Suite'
$setup = $null
if ($ServerUrl) {
  try { $setup = Invoke-RestMethod "$($ServerUrl.TrimEnd('/'))/api/setup" -UseBasicParsing -TimeoutSec 5 } catch { }
}
Write-Host "1. Dans MPV Shim (fenêtre de connexion au premier lancement, sinon son icône près de l'horloge) :"
if ($setup -and $setup.serverUrl -and $setup.userName) {
  Write-Host "   ajouter le serveur Jellyfin $($setup.serverUrl), utilisateur « $($setup.userName) » (et son mot de passe)."
} else {
  Write-Host "   ajouter le même serveur Jellyfin et le même utilisateur que l'application."
}
$where = if ($ServerUrl) { " ($ServerUrl)" } else { '' }
Write-Host "2. Ouvrir l'application$where, puis « Lire sur… » : choisir cet écran."
