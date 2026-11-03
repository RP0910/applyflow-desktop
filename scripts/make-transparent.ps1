# Knock out solid canvas (black or white) to alpha. Keeps intentional white/black marks inside glyphs.
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [ValidateSet('auto','black','white')][string]$Mode = 'auto',
  [int]$Hard = 18,
  [int]$Soft = 42
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $InputPath))
$bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, $src.Width, $src.Height)
$g.Dispose()
$src.Dispose()

# Detect canvas from corner samples when Mode=auto
if ($Mode -eq 'auto') {
  $samples = @(
    $bmp.GetPixel(0, 0),
    $bmp.GetPixel($bmp.Width - 1, 0),
    $bmp.GetPixel(0, $bmp.Height - 1),
    $bmp.GetPixel($bmp.Width - 1, $bmp.Height - 1)
  )
  $avg = ($samples | ForEach-Object { ([int]$_.R + [int]$_.G + [int]$_.B) / 3.0 } | Measure-Object -Average).Average
  $Mode = if ($avg -ge 200) { 'white' } else { 'black' }
}

for ($y = 0; $y -lt $bmp.Height; $y++) {
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $c = $bmp.GetPixel($x, $y)
    $r = [int]$c.R; $gc = [int]$c.G; $b = [int]$c.B; $a = [int]$c.A
    $min = [Math]::Min([Math]::Min($r, $gc), $b)
    $max = [Math]::Max([Math]::Max($r, $gc), $b)
    $chroma = $max - $min

    if ($Mode -eq 'black') {
      # Near-black canvas only (low chroma). Do not touch colored glows or charcoal wordmark fills.
      if ($chroma -le 14 -and $max -le $Soft) {
        if ($max -le $Hard) {
          $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        } else {
          $t = ($max - $Hard) / [double]([Math]::Max(1, $Soft - $Hard))
          $alpha = [int][Math]::Round($t * $a)
          if ($alpha -lt 10) { $alpha = 0 }
          $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $r, $gc, $b))
        }
      }
    } else {
      # Near-white canvas
      if ($chroma -le 16 -and $min -ge (255 - $Soft)) {
        if ($min -ge (255 - $Hard)) {
          $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        } else {
          $t = ((255 - $min) - $Hard) / [double]([Math]::Max(1, $Soft - $Hard))
          if ($t -lt 0) { $t = 0 }
          if ($t -gt 1) { $t = 1 }
          $alpha = [int][Math]::Round($t * $a)
          if ($alpha -lt 10) { $alpha = 0 }
          $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $r, $gc, $b))
        }
      }
    }
  }
}

$dir = Split-Path -Parent $OutputPath
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "wrote $OutputPath ($Mode)"
