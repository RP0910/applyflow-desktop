# Tight-crop a PNG to its non-transparent content (with a few pixels of padding).
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$Padding = 4,
  [int]$AlphaMin = 8
)

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $InputPath))
$minX = $src.Width; $minY = $src.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $src.Height; $y++) {
  for ($x = 0; $x -lt $src.Width; $x++) {
    if ($src.GetPixel($x, $y).A -ge $AlphaMin) {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
if ($maxX -lt 0) { throw "No opaque pixels found in $InputPath" }
$minX = [Math]::Max(0, $minX - $Padding)
$minY = [Math]::Max(0, $minY - $Padding)
$maxX = [Math]::Min($src.Width - 1, $maxX + $Padding)
$maxY = [Math]::Min($src.Height - 1, $maxY + $Padding)
$w = $maxX - $minX + 1
$h = $maxY - $minY + 1
$out = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0,0,$w,$h), (New-Object System.Drawing.Rectangle $minX,$minY,$w,$h), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()
$out.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
Write-Output "cropped ${w}x${h} -> $OutputPath"
