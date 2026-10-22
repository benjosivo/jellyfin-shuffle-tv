# Icône d'état dans la zone de notification (près de l'horloge).
#   vert = lecture · bleu = pause · gris = en attente · orange = problème (Jellyfin, MPV Shim…) · rouge = serveur arrêté
# Clic : ouvrir l'interface (ou relancer le serveur s'il est arrêté). Clic droit : menu.
# Démarrée à l'ouverture de session par le raccourci « Jellyfin en boucle (icône) » du dossier Démarrage.
param([int]$Port = 8787)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
. (Join-Path $PSScriptRoot 'common.ps1')

# Une seule icône à la fois.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\JellyfinEnBoucleTray', [ref]$created)
if (-not $created) { exit 0 }

$base = "http://127.0.0.1:$Port"
$uiUrl = "http://localhost:$Port/"
$stopped = [pscustomobject]@{
  level = 'stopped'; title = 'Arrêté'; detail = 'Le serveur Jellyfin en boucle ne répond pas.'
  canPause = $false; canResume = $false; canSkip = $false; canPrevious = $false; order = $null
}

# --- Icônes (mêmes formes et couleurs que sous Linux) ---------------------------------------

$colors = @{ playing = '#3fb27f'; paused = '#5b9be6'; idle = '#8a91a3'; warning = '#f0a830'; stopped = '#e5534b' }
function New-StateIcon([string]$level) {
  $s = 32
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($colors[$level]))), 1, 1, $s - 2, $s - 2)
  $white = [System.Drawing.Brushes]::White
  switch ($level) {
    'playing' {
      $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(0.39 * $s, 0.29 * $s),
        [System.Drawing.PointF]::new(0.39 * $s, 0.71 * $s),
        [System.Drawing.PointF]::new(0.73 * $s, 0.5 * $s))
      $g.FillPolygon($white, $points)
    }
    'paused' {
      $g.FillRectangle($white, [single](0.34 * $s), [single](0.3 * $s), [single](0.11 * $s), [single](0.4 * $s))
      $g.FillRectangle($white, [single](0.55 * $s), [single](0.3 * $s), [single](0.11 * $s), [single](0.4 * $s))
    }
    'idle' { $g.FillRectangle($white, [single](0.34 * $s), [single](0.34 * $s), [single](0.32 * $s), [single](0.32 * $s)) }
    'warning' {
      $g.FillRectangle($white, [single](0.445 * $s), [single](0.24 * $s), [single](0.11 * $s), [single](0.36 * $s))
      $g.FillRectangle($white, [single](0.445 * $s), [single](0.67 * $s), [single](0.11 * $s), [single](0.1 * $s))
    }
    'stopped' {
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([single](0.12 * $s))
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $g.DrawLine($pen, [single](0.34 * $s), [single](0.34 * $s), [single](0.66 * $s), [single](0.66 * $s))
      $g.DrawLine($pen, [single](0.66 * $s), [single](0.34 * $s), [single](0.34 * $s), [single](0.66 * $s))
    }
  }
  $g.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$icons = @{}
foreach ($level in $colors.Keys) { $icons[$level] = New-StateIcon $level }

# --- État et actions ---------------------------------------------------------------------------

$script:summary = $stopped
function Get-Summary {
  # Délai court quand le serveur est arrêté, pour que le menu reste réactif.
  $timeout = if ($script:summary.level -eq 'stopped') { 1 } else { 2 }
  try { return Invoke-RestMethod "$base/api/tray" -TimeoutSec $timeout } catch { return $stopped }
}

function Invoke-Player([string]$action) {
  try { Invoke-RestMethod "$base/api/player/$action" -Method Post -Body '{}' -ContentType 'application/json' -TimeoutSec 5 | Out-Null } catch { }
  Update-Tray
}

function Set-Order([string]$order) {
  try { Invoke-RestMethod "$base/api/order" -Method Put -Body "{`"order`":`"$order`"}" -ContentType 'application/json' -TimeoutSec 5 | Out-Null } catch { }
  Update-Tray
}

function Restart-Server {
  Stop-App
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Open-Ui([string]$suffix = '') {
  if ($script:summary.level -eq 'stopped') {
    Restart-Server
    Start-Sleep -Seconds 4
  }
  Start-Process "$uiUrl$suffix"
}

# --- Icône et menu -------------------------------------------------------------------------------

$notify = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
function Add-Item([string]$text, [scriptblock]$onClick) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem $text
  if ($onClick) { $item.Add_Click($onClick) } else { $item.Enabled = $false }
  [void]$menu.Items.Add($item)
  return $item
}
$titleItem = Add-Item 'Jellyfin en boucle' $null
$detailItem = Add-Item '' $null
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$openItem = Add-Item "Ouvrir l'interface" { Open-Ui }
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$qrItem = Add-Item 'Afficher le QR code (téléphone)' { Open-Ui '?qr=1' }
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$previousItem = Add-Item 'Épisode précédent' { Invoke-Player 'previous' }
$toggleItem = Add-Item 'Pause' { if ($script:summary.canResume) { Invoke-Player 'resume' } else { Invoke-Player 'pause' } }
$skipItem = Add-Item 'Épisode suivant' { Invoke-Player 'skip' }
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$shuffleItem = Add-Item 'Aléatoire' { Set-Order 'shuffle' }
$sequentialItem = Add-Item "Dans l'ordre" { Set-Order 'sequential' }
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$restartItem = Add-Item 'Redémarrer le serveur' { Restart-Server; Update-Tray }
$quitItem = Add-Item 'Masquer cette icône' {
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
}

$notify.ContextMenuStrip = $menu
$notify.Add_MouseClick({
  param($source, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-Ui }
})

function Update-Tray {
  $script:summary = Get-Summary
  $s = $script:summary
  $running = $s.level -ne 'stopped'
  $notify.Icon = $icons[[string]$s.level]
  # Infobulle limitée à 63 caractères par Windows.
  $tip = "Jellyfin en boucle : $($s.title)"
  if ($s.detail) { $tip = "$tip`n$($s.detail)" }
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 62) + '…' }
  $notify.Text = $tip
  $titleItem.Text = "Jellyfin en boucle : $($s.title)"
  $detailItem.Text = [string]$s.detail
  $detailItem.Visible = [bool]$s.detail
  $openItem.Enabled = $running
  $qrItem.Enabled = $running
  $toggleItem.Text = if ($s.canResume) { 'Reprendre' } else { 'Pause' }
  $toggleItem.Enabled = [bool]($s.canPause -or $s.canResume)
  $skipItem.Enabled = [bool]$s.canSkip
  $previousItem.Enabled = [bool]$s.canPrevious
  $shuffleItem.Enabled = [bool]$s.order
  $sequentialItem.Enabled = [bool]$s.order
  $shuffleItem.Checked = $s.order -eq 'shuffle'
  $sequentialItem.Checked = $s.order -eq 'sequential'
  $restartItem.Text = if ($running) { 'Redémarrer le serveur' } else { 'Démarrer le serveur' }
}

Update-Tray
$notify.Visible = $true
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({ Update-Tray })
$timer.Start()

[System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))

$timer.Stop()
$notify.Dispose()
$mutex.ReleaseMutex()
