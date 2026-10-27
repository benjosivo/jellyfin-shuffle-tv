# Fonctions communes à install.ps1 et uninstall.ps1 (chargé avec « . »).

# Step / Ok / Warn et la recherche / l'installation de MPV Shim, partagés avec /lecteur.ps1.
. (Join-Path $PSScriptRoot 'mpv-shim.ps1')

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ConfigDir = if ($env:JELLYFIN_OFFICE_DIR) { $env:JELLYFIN_OFFICE_DIR } else { Join-Path $env:APPDATA 'jellyfin-office' }
$TaskName = 'Jellyfin en boucle'
$UpdateTaskName = 'Jellyfin en boucle (mise à jour)'
$FirewallRuleName = 'Jellyfin en boucle'
$StartupDir = [Environment]::GetFolderPath('Startup')
$UiShortcut = Join-Path $StartupDir 'Jellyfin en boucle (QR code).lnk'
$StartMenuShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Jellyfin en boucle.lnk'
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jellyfin en boucle.lnk'
$TrayShortcut = Join-Path $StartupDir 'Jellyfin en boucle (icône).lnk'
$IconFile = Join-Path $AppDir 'deploy\windows\icon.ico'
$MpvShimConfigDir = Join-Path $env:APPDATA 'jellyfin-mpv-shim'

# Manifeste : ce que l'installation a réellement ajouté (une entrée « type valeur » par ligne),
# conservé entre deux installations et lu par la désinstallation, qui ne retire que ça.
$Manifest = Join-Path $ConfigDir 'install-manifest'

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

function Stop-MpvShim {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Jellyfin MPV Shim*' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

# Processus de l'application : la boucle run.ps1 et le serveur Node qu'elle lance.
function Get-AppProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'node.exe' OR Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($AppDir) -and
      ($_.CommandLine.Contains('run.ps1') -or $_.CommandLine.Contains('dist\server\index.js'))
    }
}

# Arrête la tâche planifiée et le serveur Node de l'application (fichiers libérés pour npm / suppression).
function Stop-App {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-AppProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}

# Raccourci qui lance un script PowerShell de deploy\windows sans aucune fenêtre (via launch-hidden.vbs).
function New-AppShortcut([string]$path, [string]$script, [string]$arguments, [string]$description) {
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $link.Arguments = "`"$AppDir\deploy\windows\launch-hidden.vbs`" $script $arguments"
  $link.WorkingDirectory = $AppDir
  $link.Description = $description
  if (Test-Path $IconFile) { $link.IconLocation = "$IconFile,0" }
  $link.Save()
}

# Ouvre un raccourci avec les droits normaux de l'utilisateur (via l'Explorateur), même depuis
# un script lancé en administrateur : le navigateur, l'icône et MPV Shim ne tournent pas en admin.
function Start-AsUser([string]$shortcutPath) {
  if (Test-Path $shortcutPath) { Start-Process explorer.exe -ArgumentList "`"$shortcutPath`"" }
}

function Stop-Tray {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains($AppDir) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# --- Instance déjà installée sur le réseau ---------------------------------------------------

# Réponse de /api/health d'une instance de l'application (voir src/api/routes.ts).
function Test-AppHealthText([string]$text) { return [bool]($text -match '"app"\s*:\s*"jellyfin-en-boucle"') }

function Test-AppHealth([string]$url) {
  try {
    $response = Invoke-WebRequest "$($url.TrimEnd('/'))/api/health" -UseBasicParsing -TimeoutSec 2
    return (Test-AppHealthText $response.Content)
  } catch {
    return $false
  }
}

# Instances de l'application sur le réseau local : GET /api/health sur le port donné de chaque adresse
# du /24 de ce PC (254 au plus par interface), toutes en parallèle. Renvoie les URL trouvées.
function Find-AppServers([int]$port) {
  $own = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' } | ForEach-Object { $_.IPAddress })
  if (-not $own) { return @() }
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMilliseconds(1500)
  $probes = @{}
  try {
    foreach ($prefix in ($own | ForEach-Object { $_ -replace '\.\d+$', '' } | Sort-Object -Unique)) {
      foreach ($i in 1..254) {
        $ip = "$prefix.$i"
        if ($own -contains $ip) { continue }
        $url = "http://${ip}:$port/"
        $probes[$url] = $client.GetStringAsync("${url}api/health")
      }
    }
    # WaitAll lève une exception dès qu'une sonde a échoué, mais seulement une fois toutes terminées.
    try { [void][System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($probes.Values), 5000) } catch { }
    return @($probes.Keys | Where-Object {
        $task = $probes[$_]
        $task.Status -eq 'RanToCompletion' -and (Test-AppHealthText $task.Result)
      } | Sort-Object { [int]($_ -replace '^http://[\d.]+\.(\d+):.*$', '$1') })
  } finally {
    $client.Dispose()
  }
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}
