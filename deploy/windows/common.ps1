# Fonctions communes à install.ps1 et uninstall.ps1 (chargé avec « . »).

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ConfigDir = if ($env:JELLYFIN_OFFICE_DIR) { $env:JELLYFIN_OFFICE_DIR } else { Join-Path $env:APPDATA 'jellyfin-office' }
$TaskName = 'Jellyfin en boucle'
$FirewallRuleName = 'Jellyfin en boucle'
$StartupDir = [Environment]::GetFolderPath('Startup')
$UiShortcut = Join-Path $StartupDir 'Jellyfin en boucle (QR code).lnk'
$MpvShimConfigDir = Join-Path $env:APPDATA 'jellyfin-mpv-shim'

# Manifeste : ce que l'installation a réellement ajouté (une entrée « type valeur » par ligne),
# conservé entre deux installations et lu par la désinstallation, qui ne retire que ça.
$Manifest = Join-Path $ConfigDir 'install-manifest'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "!   $text" -ForegroundColor Yellow }

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ManifestLines {
  if (Test-Path $Manifest) { return @(Get-Content $Manifest -Encoding UTF8 | Where-Object { $_ }) }
  return @()
}
function Add-Manifest([string]$kind, [string]$value) {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  $line = "$kind $value"
  if ((Get-ManifestLines) -notcontains $line) { Add-Content -Path $Manifest -Value $line -Encoding UTF8 }
}
function Test-Manifest([string]$kind, [string]$value) { return (Get-ManifestLines) -contains "$kind $value" }
function Get-ManifestValues([string]$kind) {
  return @(Get-ManifestLines | Where-Object { $_.StartsWith("$kind ") } | ForEach-Object { $_.Substring($kind.Length + 1) })
}

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

function Stop-MpvShim {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Jellyfin MPV Shim*' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

# Arrête la tâche planifiée et le serveur Node de l'application (fichiers libérés pour npm / suppression).
function Stop-App {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'node.exe' OR Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($AppDir) -and
      ($_.CommandLine.Contains('run.ps1') -or $_.CommandLine.Contains('dist\server\index.js'))
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}
