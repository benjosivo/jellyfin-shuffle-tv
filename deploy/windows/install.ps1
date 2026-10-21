#Requires -Version 5.1
<#
.SYNOPSIS
  Installation de « Jellyfin en boucle » sous Windows.

.DESCRIPTION
  Node.js, Jellyfin MPV Shim, build, démarrage automatique au login (tâche planifiée, sans fenêtre),
  règle de pare-feu pour le téléphone, ouverture de la page QR code au login.
  Ce script ne supprime rien.

  Lancement (PowerShell, dans le dossier du projet) :
    powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1

.PARAMETER Port
  Port de l'interface web (8787 par défaut).
.PARAMETER NoMpvShim
  Ne pas installer Jellyfin MPV Shim.
.PARAMETER NoOpenUi
  Ne pas ouvrir la page QR code à chaque ouverture de session.
#>
param(
  [int]$Port = 8787,
  [switch]$NoMpvShim,
  [switch]$NoOpenUi
)

$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TaskName = 'Jellyfin en boucle'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "!   $text" -ForegroundColor Yellow }
function Ask($question) {
  $answer = Read-Host "$question [O/n]"
  return ($answer -eq '' -or $answer -match '^[oOyY]')
}
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

# --- Élévation (pare-feu et tâche planifiée au login) ---------------------------------

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Droits administrateur nécessaires (pare-feu, tâche planifiée) : confirmation demandée par Windows."
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port)
  if ($NoMpvShim) { $argsList += '-NoMpvShim' }
  if ($NoOpenUi) { $argsList += '-NoOpenUi' }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $argsList -Wait
  exit
}
$UserId = "$env:USERDOMAIN\$env:USERNAME"

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
  winget install --exact --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Refresh-Path
  if ((Get-NodeMajor) -lt 20) { throw 'Node.js toujours introuvable : ouvrir un nouveau PowerShell et relancer.' }
}
$NodeExe = (Get-Command node).Source
Ok "Node.js $(& node --version) ($NodeExe)"

# --- 2. Jellyfin MPV Shim -------------------------------------------------------------

Step 'Jellyfin MPV Shim'
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

$installed = Find-MpvShim
if ($installed) {
  Ok "Déjà installé : $($installed.DisplayName)"
} elseif (-not $NoMpvShim -and (Ask "Jellyfin MPV Shim n'est pas installé. Le télécharger et l'installer ?")) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $release = Invoke-RestMethod 'https://api.github.com/repos/jellyfin/jellyfin-mpv-shim/releases/latest' -Headers @{ 'User-Agent' = 'jellyfin-en-boucle' }
  $asset = $release.assets | Where-Object { $_.name -match '\.exe$' -and $_.name -match 'setup|install' } | Select-Object -First 1
  if (-not $asset) { $asset = $release.assets | Where-Object { $_.name -match '\.exe$' } | Select-Object -First 1 }
  if (-not $asset) {
    Warn "Installeur introuvable dans la release $($release.tag_name) : https://github.com/jellyfin/jellyfin-mpv-shim/releases"
  } else {
    $setup = Join-Path $env:TEMP $asset.name
    Write-Host "Téléchargement de $($asset.name)…"
    Invoke-WebRequest $asset.browser_download_url -OutFile $setup -UseBasicParsing
    Write-Host "Suivre l'installeur qui s'ouvre…"
    Start-Process $setup -Wait
    if (Find-MpvShim) { Ok 'Jellyfin MPV Shim installé.' } else { Warn "Installation non détectée : vérifier qu'elle s'est bien terminée." }
  }
} else {
  Warn 'MPV Shim non installé : la lecture ne pourra pas démarrer sans lui.'
}

# Démarrage automatique de MPV Shim (raccourci dans le dossier Démarrage).
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Find-MpvShimShortcut
if ($shortcut) {
  $existing = Get-ChildItem $startup -Filter '*MPV Shim*.lnk' -ErrorAction SilentlyContinue
  if ($existing) {
    Ok 'MPV Shim démarre déjà automatiquement.'
  } else {
    Copy-Item $shortcut.FullName (Join-Path $startup $shortcut.Name)
    Ok 'Démarrage automatique de MPV Shim ajouté.'
  }
}

# --- 3. Build --------------------------------------------------------------------------------

Step 'Installation des dépendances et build'
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
# Relance propre si une ancienne version tourne déjà.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$AppDir*dist*server*index.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName $TaskName
Ok "Tâche planifiée « $TaskName » créée et lancée."

# --- 5. Pare-feu ------------------------------------------------------------------------------

Step 'Pare-feu (accès depuis le téléphone)'
Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $TaskName -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Action Allow -Profile Private, Domain | Out-Null
Ok "Port $Port ouvert sur les réseaux privés."
$public = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }
foreach ($net in $public) {
  Warn "Le réseau « $($net.Name) » est en mode Public : le téléphone ne pourra pas joindre ce PC."
  if (Ask "Passer « $($net.Name) » en réseau privé (à faire seulement pour le réseau de la maison) ?") {
    Set-NetConnectionProfile -InterfaceIndex $net.InterfaceIndex -NetworkCategory Private
    Ok "« $($net.Name) » est maintenant un réseau privé."
  }
}

# --- 6. Page QR code à l'ouverture de session ----------------------------------------------

Step 'Page QR code au login'
$uiShortcut = Join-Path $startup 'Jellyfin en boucle (QR code).lnk'
if ($NoOpenUi) {
  Ok 'Ignorée (-NoOpenUi).'
} else {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($uiShortcut)
  $link.TargetPath = 'powershell.exe'
  $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AppDir\deploy\windows\open-ui.ps1`" -Port $Port"
  $link.WindowStyle = 7
  $link.Save()
  Ok "Ajoutée : $uiShortcut (supprimer ce raccourci pour la désactiver)."
}

# --- Fin ----------------------------------------------------------------------------------------

Step 'Terminé'
Write-Host "Interface : http://localhost:$Port/  (le QR code pour le téléphone s'y affiche)"
Write-Host "Journal   : $env:APPDATA\jellyfin-office\service.log"
if (Ask "Ouvrir l'interface maintenant ?") {
  & (Join-Path $AppDir 'deploy\windows\open-ui.ps1') -Port $Port
}
Read-Host 'Appuyer sur Entrée pour fermer'
