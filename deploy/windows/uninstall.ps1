#Requires -Version 5.1
<#
.SYNOPSIS
  Désinstallation complète de « Jellyfin en boucle » sous Windows.

.DESCRIPTION
  Retire les tâches planifiées, la règle de pare-feu, les raccourcis de démarrage et tout le dossier
  de configuration (jeton, identifiants, historique, journaux), après révocation des jetons
  côté Jellyfin. MPV Shim et Node.js ne sont retirés que si c'est l'installation qui les avait
  ajoutés ; ce qui existait avant reste en place. Peut être relancé sans risque.

    powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall.ps1

.PARAMETER Yes
  Pas de confirmation.
.PARAMETER KeepThirdParty
  Garder MPV Shim et Node.js même s'ils ont été installés par l'installation.
.PARAMETER RemoveFolder
  Supprimer aussi le dossier du projet (code source).
#>
param(
  [switch]$Yes,
  [switch]$KeepThirdParty,
  [switch]$RemoveFolder
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-Admin)) {
  Write-Host "Droits administrateur nécessaires (pare-feu, tâche planifiée) : confirmation demandée par Windows."
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Yes) { $argsList += '-Yes' }
  if ($KeepThirdParty) { $argsList += '-KeepThirdParty' }
  if ($RemoveFolder) { $argsList += '-RemoveFolder' }
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $argsList -Wait -PassThru
  exit $process.ExitCode
}

$hasManifest = Test-Path $Manifest
$removeMpvShim = (-not $KeepThirdParty) -and ((Get-ManifestValues 'mpv-shim') -contains 'inno')
$removeNode = (-not $KeepThirdParty) -and ((Get-ManifestValues 'node') -contains 'winget')

# --- Résumé et confirmation -----------------------------------------------------------------

Step 'Désinstallation de Jellyfin en boucle'
Write-Host 'Seront supprimés :'
Write-Host "  - les tâches planifiées « $TaskName » et « $UpdateTaskName », la règle de pare-feu et les raccourcis de démarrage"
Write-Host "  - $ConfigDir (jeton Jellyfin, identifiants, historique, journaux), après révocation du jeton"
Write-Host "  - node_modules et dist dans $AppDir"
if ($RemoveFolder) { Write-Host "  - le dossier $AppDir lui-même" }
if ($removeMpvShim) { Write-Host '  - Jellyfin MPV Shim et sa configuration' }
if ($removeNode) { Write-Host '  - Node.js (installé par l''installation)' }
foreach ($net in Get-ManifestValues 'network') { Write-Host "  - le réseau « $net » repassera en mode Public" }
if (-not $hasManifest) { Warn "Aucun manifeste d'installation : MPV Shim et Node.js seront laissés en place." }
if (-not $Yes) {
  $answer = Read-Host 'Continuer ? [o/N]'
  if ($answer -notmatch '^[oOyY]') { Write-Host 'Annulé.'; exit 0 }
}

# --- 1. Révocation des jetons Jellyfin --------------------------------------------------------

Step 'Révocation des jetons Jellyfin'
$cli = Join-Path $AppDir 'dist\server\cli\uninstall.js'
if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $cli)) {
  $revokeArgs = @($cli, '--config-dir', $ConfigDir)
  if ($removeMpvShim) { $revokeArgs += @('--mpv-shim-config', $MpvShimConfigDir) }
  & node @revokeArgs
} else {
  Warn 'Node.js ou le build est absent : jetons non révoqués côté serveur (ils sont quand même effacés de ce PC).'
}

# --- 2. Tâche planifiée et processus ----------------------------------------------------------

Step 'Démarrage automatique'
# La mise à jour d'abord : elle relancerait l'application qu'on arrête.
Stop-ScheduledTask -TaskName $UpdateTaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $UpdateTaskName -Confirm:$false -ErrorAction SilentlyContinue
Stop-App
Stop-Tray
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item $UiShortcut, $StartMenuShortcut, $DesktopShortcut, $TrayShortcut -Force -ErrorAction SilentlyContinue
foreach ($file in Get-ManifestValues 'file') { Remove-Item $file -Force -ErrorAction SilentlyContinue }
Ok "Tâche planifiée, icône d'état et raccourcis supprimés."

# --- 3. Pare-feu et réseau ------------------------------------------------------------------------

Step 'Pare-feu'
Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Ok 'Règle supprimée.'
foreach ($name in Get-ManifestValues 'network') {
  $net = Get-NetConnectionProfile -Name $name -ErrorAction SilentlyContinue
  if ($net -and $net.NetworkCategory -eq 'Private') {
    Set-NetConnectionProfile -InterfaceIndex $net.InterfaceIndex -NetworkCategory Public
    Ok "« $name » est de nouveau un réseau public."
  }
}

# --- 4. Jellyfin MPV Shim ----------------------------------------------------------------------

Step 'Jellyfin MPV Shim'
if ($removeMpvShim) {
  Stop-MpvShim
  $entry = Find-MpvShim
  if ($entry -and $entry.UninstallString) {
    $uninstaller = $entry.UninstallString.Trim('"')
    $process = Start-Process $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
    if ($process.ExitCode -eq 0) { Ok 'MPV Shim désinstallé.' } else { Warn "Désinstallation de MPV Shim : code $($process.ExitCode)." }
  }
  Get-ChildItem $StartupDir -Filter '*MPV Shim*.lnk' -ErrorAction SilentlyContinue |
    Where-Object { (Get-ManifestValues 'file') -contains $_.FullName } | Remove-Item -Force
  Remove-Item $MpvShimConfigDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $env:LOCALAPPDATA 'jellyfin-mpv-shim') -Recurse -Force -ErrorAction SilentlyContinue
  Ok 'Configuration de MPV Shim supprimée.'
} elseif ($KeepThirdParty) {
  Ok 'Conservé (-KeepThirdParty).'
} else {
  Ok "Pas installé par l'installation : laissé en place."
}

# --- 5. Fichiers de l'application ----------------------------------------------------------------

Step "Fichiers de l'application"
Remove-Item (Join-Path $AppDir 'node_modules'), (Join-Path $AppDir 'dist') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $ConfigDir) { Warn "$ConfigDir n'a pas pu être entièrement supprimé (fichier ouvert ?)." } else { Ok "Configuration et secrets effacés ($ConfigDir)." }

# --- 6. Node.js (en dernier : il servait à la révocation) ---------------------------------------

Step 'Node.js'
if ($removeNode) {
  & winget uninstall --exact --id OpenJS.NodeJS.LTS --silent --accept-source-agreements
  if ($LASTEXITCODE -eq 0) { Ok 'Node.js désinstallé.' } else { Warn "Désinstallation de Node.js : code $LASTEXITCODE." }
} else {
  Ok "Pas installé par l'installation (ou -KeepThirdParty) : laissé en place."
}

if ($RemoveFolder) {
  Set-Location $env:TEMP
  # Le script s'exécute depuis ce dossier : suppression différée de quelques secondes.
  Start-Process cmd.exe -ArgumentList '/d', '/c', "timeout /t 3 /nobreak >nul & rmdir /s /q `"$AppDir`"" -WindowStyle Hidden
  Ok "Dossier $AppDir supprimé dans quelques secondes."
} else {
  Ok "Le dossier $AppDir (code source, sans secret) est conservé : install.ps1 pour réinstaller."
}

Step 'Désinstallation terminée'
if (-not $Yes) { Read-Host 'Appuyer sur Entrée pour fermer' | Out-Null }
