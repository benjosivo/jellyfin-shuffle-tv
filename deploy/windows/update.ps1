#Requires -Version 5.1
<#
.SYNOPSIS
  Mise à jour de « Jellyfin en boucle » depuis le dépôt git (sans droits administrateur).

.DESCRIPTION
  Récupère la branche suivie (fast-forward uniquement), réinstalle les dépendances si
  package.json ou package-lock.json ont changé, recompile, puis relance l'application si elle
  tournait. En cas d'échec de l'installation ou du build, l'ancienne version est rétablie.
  Ne fait rien si le dossier contient des modifications locales ou des commits non publiés.
  Lancé chaque jour et à l'ouverture de session par la tâche planifiée « Jellyfin en boucle (mise à jour) ».
  Journal : update.log dans le dossier de configuration.

    powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
#>
param()

# Les commandes natives (git, npm) écrivent sur stderr sans que ce soit une erreur : codes de sortie vérifiés à la main.
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

$Log = Join-Path $ConfigDir 'update.log'
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 1MB) { Move-Item $Log "$Log.old" -Force }

function Log($text) {
  $line = "$(Get-Date -Format s) $text"
  Write-Host $line
  Add-Content $Log $line -Encoding UTF8
}

function Invoke-Git {
  $output = & git -C $AppDir @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') : $(($output | Out-String).Trim())" }
  return ($output | Out-String).Trim()
}

# Sortie de npm ajoutée au journal en UTF-8 brut (la redirection PowerShell 5.1 écrirait de l'UTF-16).
function Invoke-Npm([string]$arguments) {
  Push-Location $AppDir
  try {
    & cmd.exe /d /c "npm $arguments >> `"$Log`" 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "npm $arguments a échoué (code $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

function Build([bool]$withDeps) {
  if ($withDeps) { Invoke-Npm 'ci --no-audit --no-fund' }
  Invoke-Npm 'run build'
}

function Start-App {
  try {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  } catch {
    $port = (Get-ManifestValues 'port' | Select-Object -First 1)
    if (-not $port) { $port = '8787' }
    Start-Process wscript.exe -ArgumentList "`"$(Join-Path $PSScriptRoot 'run-hidden.vbs')`" $port"
  }
}

# Une seule mise à jour à la fois (tâche planifiée + lancement manuel).
$mutex = New-Object System.Threading.Mutex($false, 'Local\JellyfinEnBoucleUpdate')
if (-not $mutex.WaitOne(0)) { Log 'Une mise à jour est déjà en cours.'; exit 0 }

$exitCode = 0
try {
  Refresh-Path
  if (-not (Test-Path (Join-Path $AppDir '.git'))) { Log "Pas de dépôt git dans $AppDir : mise à jour impossible."; exit 0 }
  try { $upstream = Invoke-Git rev-parse --abbrev-ref '@{u}' } catch { Log 'La branche courante ne suit aucune branche distante : rien à mettre à jour.'; exit 0 }

  Invoke-Git fetch --quiet | Out-Null
  $old = Invoke-Git rev-parse HEAD
  $new = Invoke-Git rev-parse '@{u}'
  if ($old -eq $new) { Log "À jour ($($old.Substring(0, 7)), $upstream)."; exit 0 }
  if ((Invoke-Git merge-base HEAD '@{u}') -ne $old) {
    Log "Des commits locaux ne sont pas publiés sur $upstream : mise à jour ignorée."
    exit 0
  }
  if (Invoke-Git status --porcelain --untracked-files=no) {
    Log 'Des fichiers suivis ont été modifiés localement : mise à jour ignorée.'
    exit 0
  }

  $changed = @((Invoke-Git diff --name-only $old $new) -split "`n" | ForEach-Object { $_.Trim() })
  $depsChanged = [bool]($changed -match '^package(-lock)?\.json$') -or -not (Test-Path (Join-Path $AppDir 'node_modules'))
  Log "Mise à jour $($old.Substring(0, 7)) -> $($new.Substring(0, 7)) ($upstream)."

  # Relancée seulement si elle tournait : une application arrêtée volontairement le reste.
  $wasRunning = [bool](Get-AppProcesses)
  Stop-App
  try {
    Invoke-Git merge --ff-only '@{u}' | Out-Null
    Build $depsChanged
    Log 'Build terminé.'
  } catch {
    Log "Échec : $($_.Exception.Message)"
    Log "Retour à la version précédente ($($old.Substring(0, 7)))."
    $exitCode = 1
    try {
      Invoke-Git reset --hard $old | Out-Null
      Build $true
    } catch {
      Log "Le retour arrière a échoué aussi : $($_.Exception.Message)"
    }
  }
  if ($wasRunning) { Start-App; Log 'Application relancée.' }
} catch {
  Log "Erreur : $($_.Exception.Message)"
  $exitCode = 1
} finally {
  $mutex.ReleaseMutex()
}
exit $exitCode
