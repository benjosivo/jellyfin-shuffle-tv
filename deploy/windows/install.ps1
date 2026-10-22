#Requires -Version 5.1
<#
.SYNOPSIS
  Installation de « Jellyfin en boucle » sous Windows.

.DESCRIPTION
  Node.js, Jellyfin MPV Shim (installation silencieuse), build, démarrage automatique au login
  (tâche planifiée, sans fenêtre), règle de pare-feu pour le téléphone, page QR code au login.
  Tout ce qui est ajouté est noté pour que uninstall.ps1 le retire proprement.
  Peut être relancé autant de fois que voulu.

  Lancement (PowerShell, dans le dossier du projet) :
    powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1

.PARAMETER Port
  Port de l'interface web (8787 par défaut).
.PARAMETER Yes
  Ne poser aucune question (sauf le passage d'un réseau public en privé, jamais fait d'office).
.PARAMETER NoMpvShim
  Ne pas installer Jellyfin MPV Shim.
.PARAMETER NoOpenUi
  Ne pas ouvrir la page QR code à chaque ouverture de session.
.PARAMETER NoShortcuts
  Ne pas créer les raccourcis « Jellyfin en boucle » (menu Démarrer et bureau).
.PARAMETER NoTray
  Ne pas afficher l'icône d'état près de l'horloge.
.PARAMETER NoAutoUpdate
  Ne pas installer la mise à jour automatique (tâche quotidienne qui lance update.ps1).
#>
param(
  [int]$Port = 8787,
  [switch]$Yes,
  [switch]$NoMpvShim,
  [switch]$NoOpenUi,
  [switch]$NoShortcuts,
  [switch]$NoTray,
  [switch]$NoAutoUpdate
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Ask($question, [switch]$Always) {
  if ($Yes -and -not $Always) { return $true }
  $answer = Read-Host "$question [O/n]"
  return ($answer -eq '' -or $answer -match '^[oOyY]')
}

# --- Élévation (pare-feu et tâche planifiée au login) ---------------------------------

if (-not (Test-Admin)) {
  Write-Host "Droits administrateur nécessaires (pare-feu, tâche planifiée) : confirmation demandée par Windows."
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port)
  if ($Yes) { $argsList += '-Yes' }
  if ($NoMpvShim) { $argsList += '-NoMpvShim' }
  if ($NoOpenUi) { $argsList += '-NoOpenUi' }
  if ($NoShortcuts) { $argsList += '-NoShortcuts' }
  if ($NoTray) { $argsList += '-NoTray' }
  if ($NoAutoUpdate) { $argsList += '-NoAutoUpdate' }
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $argsList -Wait -PassThru
  exit $process.ExitCode
}
$UserId = "$env:USERDOMAIN\$env:USERNAME"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
Add-Manifest 'port' "$Port"

# --- 1. Node.js ---------------------------------------------------------------------------

Step 'Node.js'
function Get-NodeMajor {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
  return [int](& node -p "process.versions.node.split('.')[0]")
}
if ((Get-NodeMajor) -lt 20) {
  Warn 'Node.js 20 ou plus est requis.'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget introuvable : installer Node.js LTS depuis https://nodejs.org puis relancer.'
  }
  & winget install --exact --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -eq 0) { Add-Manifest 'node' 'winget' }
  Refresh-Path
  if ((Get-NodeMajor) -lt 20) { throw 'Node.js toujours introuvable : ouvrir un nouveau PowerShell et relancer.' }
}
Ok "Node.js $(& node --version) ($((Get-Command node).Source))"

# --- 2. Jellyfin MPV Shim -------------------------------------------------------------

Step 'Jellyfin MPV Shim'
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

$installed = Find-MpvShim
if ($installed) {
  Ok "Déjà installé : $($installed.DisplayName)"
} elseif (-not $NoMpvShim -and (Ask "Jellyfin MPV Shim n'est pas installé. L'installer ?")) {
  if (Install-MpvShim) {
    Add-Manifest 'mpv-shim' 'inno'
    Ok 'Jellyfin MPV Shim installé.'
  } else {
    Warn "Installation non détectée : vérifier qu'elle s'est bien terminée."
  }
} else {
  Warn 'MPV Shim non installé : la lecture ne pourra pas démarrer sans lui.'
}

$shortcut = Find-MpvShimShortcut
if ($shortcut) {
  # Démarrage automatique de MPV Shim (raccourci dans le dossier Démarrage), s'il n'est pas déjà prévu.
  $startupLink = Join-Path $StartupDir $shortcut.Name
  $existing = Get-ChildItem $StartupDir -Filter '*MPV Shim*.lnk' -ErrorAction SilentlyContinue
  if (-not $existing -or (Test-Manifest 'file' $startupLink)) {
    Copy-Item $shortcut.FullName $startupLink -Force
    Add-Manifest 'file' $startupLink
    Ok 'MPV Shim démarre automatiquement.'
  } else {
    Ok 'MPV Shim démarre déjà automatiquement.'
  }
  # Premier lancement, pour pouvoir le connecter tout de suite (assistant de l'interface).
  if (-not (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Jellyfin MPV Shim*' })) {
    Start-AsUser $shortcut.FullName
  }
}

# --- 3. Build --------------------------------------------------------------------------------

Step 'Installation des dépendances et build'
# Une version précédente peut tourner et verrouiller des fichiers : on l'arrête d'abord.
Stop-App
Push-Location $AppDir
try {
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci a échoué.' }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build a échoué.' }
} finally {
  Pop-Location
}
Ok 'Build terminé.'

# --- 4. Démarrage automatique (tâche planifiée au login, sans fenêtre) --------------------

Step 'Démarrage automatique'
$vbs = Join-Path $AppDir 'deploy\windows\run-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`" $Port" -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserId
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Jellyfin en boucle : pilotage de MPV Shim + interface web (port $Port)" -Force | Out-Null
Add-Manifest 'task' $TaskName
Start-ScheduledTask -TaskName $TaskName
Ok "Tâche planifiée « $TaskName » créée et lancée."

# --- 5. Pare-feu ------------------------------------------------------------------------------

Step 'Pare-feu (accès depuis le téléphone)'
Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $FirewallRuleName -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Action Allow -Profile Private, Domain | Out-Null
Add-Manifest 'firewall' $FirewallRuleName
Ok "Port $Port ouvert sur les réseaux privés."
$public = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }
foreach ($net in $public) {
  Warn "Le réseau « $($net.Name) » est en mode Public : le téléphone ne pourra pas joindre ce PC."
  # Toujours demandé, même avec -Yes : à ne faire que pour le réseau de la maison.
  if (Ask "Passer « $($net.Name) » en réseau privé (seulement si c'est le réseau de la maison) ?" -Always) {
    Set-NetConnectionProfile -InterfaceIndex $net.InterfaceIndex -NetworkCategory Private
    Add-Manifest 'network' $net.Name
    Ok "« $($net.Name) » est maintenant un réseau privé."
  }
}

# --- 6. Page QR code à l'ouverture de session ----------------------------------------------

Step 'Page QR code au login'
if ($NoOpenUi) {
  Remove-Item $UiShortcut -Force -ErrorAction SilentlyContinue
  Ok 'Ignorée (-NoOpenUi).'
} else {
  New-AppShortcut $UiShortcut 'open-ui.ps1' "-Port $Port" 'Affiche le QR code pour piloter la lecture depuis le téléphone'
  Add-Manifest 'file' $UiShortcut
  Ok "Ajoutée : $UiShortcut"
}

# --- 7. Raccourcis menu Démarrer et bureau ----------------------------------------------------

Step 'Raccourcis « Jellyfin en boucle »'
if ($NoShortcuts) {
  Remove-Item $StartMenuShortcut, $DesktopShortcut -Force -ErrorAction SilentlyContinue
  Ok 'Ignorés (-NoShortcuts).'
} else {
  # Relance le serveur s'il est arrêté, puis ouvre l'interface avec le QR code.
  foreach ($shortcutPath in @($StartMenuShortcut, $DesktopShortcut)) {
    New-AppShortcut $shortcutPath 'open-ui.ps1' "-Port $Port -StartServer" "Démarre Jellyfin en boucle et ouvre l'interface"
    Add-Manifest 'file' $shortcutPath
  }
  Ok 'Ajoutés dans le menu Démarrer et sur le bureau.'
}

# --- 8. Icône d'état près de l'horloge -------------------------------------------------------

Step "Icône d'état (zone de notification)"
Stop-Tray
if ($NoTray) {
  Remove-Item $TrayShortcut -Force -ErrorAction SilentlyContinue
  Ok 'Ignorée (-NoTray).'
} else {
  New-AppShortcut $TrayShortcut 'tray.ps1' "-Port $Port" "Icône d'état de Jellyfin en boucle"
  Add-Manifest 'file' $TrayShortcut
  Start-AsUser $TrayShortcut
  Ok "Affichée près de l'horloge (vert = lecture, orange = problème, rouge = arrêté)."
  Write-Host "    Si elle est cachée : flèche ^ près de l'horloge, puis la faire glisser dans la barre des tâches."
}

# --- 9. Mise à jour automatique -----------------------------------------------------------------

Step 'Mise à jour automatique'
Unregister-ScheduledTask -TaskName $UpdateTaskName -Confirm:$false -ErrorAction SilentlyContinue
$upstream = & git -C $AppDir rev-parse --abbrev-ref '@{u}' 2>$null
if ($NoAutoUpdate) {
  Ok 'Ignorée (-NoAutoUpdate) : lancer deploy\windows\update.ps1 à la main.'
} elseif ($LASTEXITCODE -ne 0) {
  Warn "Le dossier n'est pas un dépôt git suivant une branche distante : mise à jour automatique non installée."
} else {
  $updateVbs = Join-Path $AppDir 'deploy\windows\update-hidden.vbs'
  $updateAction = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$updateVbs`"" -WorkingDirectory $AppDir
  # Chaque jour à 4 h (rattrapé à l'ouverture de session si le PC était éteint), et 5 minutes après chaque login.
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $UserId
  $logon.Delay = 'PT5M'
  $updateTriggers = @((New-ScheduledTaskTrigger -Daily -At '04:00'), $logon)
  $updateSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $UpdateTaskName -Action $updateAction -Trigger $updateTriggers -Settings $updateSettings -Principal $principal `
    -Description "Jellyfin en boucle : récupère les nouvelles versions ($upstream) et relance l'application" -Force | Out-Null
  Add-Manifest 'update-task' $UpdateTaskName
  Ok "Tâche « $UpdateTaskName » créée (suit $upstream, tous les jours à 4 h et à l'ouverture de session)."
}

# --- Fin ----------------------------------------------------------------------------------------

Step 'Terminé'
Write-Host "Interface    : http://localhost:$Port/  (le QR code pour le téléphone s'y affiche)"
Write-Host "Relancer     : raccourci « Jellyfin en boucle » (menu Démarrer ou bureau)"
Write-Host "Journal      : $ConfigDir\service.log  (mises à jour : update.log)"
Write-Host "Désinstaller : powershell -ExecutionPolicy Bypass -File `"$AppDir\deploy\windows\uninstall.ps1`""
if (-not $NoOpenUi) { Start-AsUser $UiShortcut }
if (-not $Yes) { Read-Host 'Appuyer sur Entrée pour fermer' | Out-Null }
