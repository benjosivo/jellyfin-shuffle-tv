#Requires -Version 5.1
<#
.SYNOPSIS
  Installation de « Jellyfin en boucle » sous Windows.

.DESCRIPTION
  Demande d'abord « serveur ou écran » : une instance déjà présente sur le réseau fait proposer
  « écran » (Jellyfin MPV Shim seul, sans droits administrateur, piloté par cette instance).
  Serveur : Node.js, Jellyfin MPV Shim (installation silencieuse), build, démarrage automatique au login
  (tâche planifiée, sans fenêtre), règle de pare-feu pour le téléphone, page QR code au login.
  Tout ce qui est ajouté est noté pour que uninstall.ps1 le retire proprement.
  Peut être relancé autant de fois que voulu.

  Lancement (PowerShell, dans le dossier du projet) :
    powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1

.PARAMETER Port
  Port de l'interface web (8787 par défaut).
.PARAMETER Server
  Installer le serveur (l'application) sans demander.
.PARAMETER Client
  N'installer que l'écran (Jellyfin MPV Shim), piloté par un serveur existant.
.PARAMETER ServerUrl
  Adresse d'une instance que la recherche ne trouve pas (autre port, autre réseau), par ex. http://192.168.1.20:8787/.
.PARAMETER Yes
  Ne poser aucune question (sauf « serveur ou écran » et le passage d'un réseau public en privé).
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
  [switch]$Server,
  [switch]$Client,
  [string]$ServerUrl,
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

# --- 0. Serveur ou écran ? -------------------------------------------------------------------

# Une seule instance (le serveur) pilote tous les écrans via Jellyfin ; un écran n'a besoin que de
# MPV Shim, sans droits administrateur. Choisi avant l'élévation, qui relance le script avec -Server.
# Ce PC est déjà serveur si une installation précédente l'a noté ou si l'application y répond.
if ($Server -and $Client) { throw '-Server et -Client ne vont pas ensemble.' }
$Role = if ($Server) { 'server' } elseif ($Client) { 'client' } else { $null }
Step 'Serveur ou écran ?'
$alreadyServer = ((Get-ManifestValues 'port') -contains "$Port") -or (Test-AppHealth "http://127.0.0.1:$Port/")
if (-not $ServerUrl -and $alreadyServer) {
  $ServerUrl = "http://localhost:$Port/"
} elseif (-not $ServerUrl -and $Role -ne 'server') {
  Write-Host "Recherche d'une instance de l'application sur le réseau (port $Port)…"
  $found = @(Find-AppServers $Port)
  if ($found.Count -gt 0) {
    foreach ($url in $found) { Ok "Instance trouvée : $url" }
    $ServerUrl = $found[0]
  } else {
    Ok 'Aucune instance trouvée (autre port ou autre réseau : -ServerUrl <adresse>).'
  }
}

if (-not $Role) {
  $default = '1'
  $reason = 'aucune instance sur le réseau, ce PC sera le serveur'
  if ($alreadyServer) {
    $reason = 'ce PC est déjà le serveur : réinstallation ou mise à jour'
  } elseif ($ServerUrl) {
    $default = '2'
    $reason = "un serveur existe déjà ($ServerUrl), ce PC sera un écran"
  }
  Write-Host 'Que faut-il installer sur ce PC ?'
  Write-Host "  1) Serveur : l'application qui pilote la lecture (une seule sur le réseau)"
  Write-Host '  2) Écran   : seulement Jellyfin MPV Shim, piloté par le serveur'
  Write-Host "Conseillé : $default ($reason)."
  # Toujours demandé, même avec -Yes : c'est le seul vrai choix de l'installation.
  if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    while (-not $Role) {
      $choice = Read-Host "Choix [$default]"
      if (-not $choice) { $choice = $default }
      switch ($choice) {
        '1' { $Role = 'server' }
        '2' { $Role = 'client' }
        default { Warn 'Répondre 1 ou 2.' }
      }
    }
    # Deux serveurs piloteraient les mêmes écrans en même temps.
    if ($Role -eq 'server' -and -not $alreadyServer -and $ServerUrl) {
      Warn "Un serveur tourne déjà ($ServerUrl) : un second piloterait les mêmes écrans en même temps."
      $answer = Read-Host 'Installer quand même un second serveur ? [o/N]'
      if ($answer -notmatch '^[oOyY]') { throw 'Installation annulée : relancer et choisir 2 (écran).' }
    }
  } else {
    $Role = if ($default -eq '1') { 'server' } else { 'client' }
    Ok "Pas de terminal interactif : choix $default."
  }
}

if ($Role -eq 'client') {
  if ($alreadyServer) {
    Warn "Ce PC est déjà serveur : l'application reste installée. Pour ne garder que l'écran : deploy\windows\uninstall.ps1, puis relancer avec -Client."
  }
  # Même installation que la commande de Réglages → Ajouter un écran (/lecteur.ps1), consignes comprises.
  . (Join-Path $PSScriptRoot 'lecteur.ps1')
  exit 0
}
Ok 'Installation du serveur.'

# --- Élévation (pare-feu et tâche planifiée au login) ---------------------------------

if (-not (Test-Admin)) {
  Write-Host "Droits administrateur nécessaires (pare-feu, tâche planifiée) : confirmation demandée par Windows."
  # -Server : le choix est déjà fait, la fenêtre administrateur ne le redemande pas.
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port, '-Server')
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

# --- 3b. Compresseur audio -----------------------------------------------------------------

Step 'Compresseur audio (MPV Shim)'
if (Find-MpvShim) {
  # Activé seulement si rien n'a été décidé : un réglage ou un filtre existant est conservé.
  & node (Join-Path $AppDir 'dist\server\cli\audio.js') enable-default --dir $MpvShimConfigDir
} else {
  Ok 'Ignoré : MPV Shim non installé.'
}

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
