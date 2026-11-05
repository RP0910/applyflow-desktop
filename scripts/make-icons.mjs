import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'build');
const publicIcons = resolve(root, 'public/icons');
mkdirSync(resolve(out, 'icons'), { recursive: true });
mkdirSync(publicIcons, { recursive: true });
mkdirSync(resolve(root, 'public/brand'), { recursive: true });
mkdirSync(resolve(out, 'brand'), { recursive: true });

const sourceCandidates = [
  resolve(root, 'brand/app-icon-source.png'),
  resolve(root, 'brand/app-icon-source.jpg'),
  resolve(root, 'brand/app-icon-source.jpeg'),
];
const source = sourceCandidates.find((p) => existsSync(p));
if (!source) {
  console.error('Missing brand/app-icon-source.jpg (or .png). Place the app icon there and re-run.');
  process.exit(1);
}

const headerLogo = resolve(root, 'brand/logo-header.png');
if (existsSync(headerLogo)) {
  copyFileSync(headerLogo, resolve(root, 'public/brand/logo-header.png'));
  copyFileSync(headerLogo, resolve(out, 'brand/logo-header.png'));
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ps = `
Add-Type -AssemblyName System.Drawing
$srcPath = ${JSON.stringify(source)}
$outDir = ${JSON.stringify(resolve(out, 'icons'))}
$publicDir = ${JSON.stringify(publicIcons)}
$buildRoot = ${JSON.stringify(out)}
$img = [System.Drawing.Image]::FromFile($srcPath)
$sizes = @(${sizes.join(',')})
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($img, 0, 0, $size, $size)
  $g.Dispose()
  $dest = Join-Path $outDir ("{0}x{0}.png" -f $size)
  $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($size -in 16,32,48,128,512) {
    Copy-Item $dest (Join-Path $publicDir ("icon-{0}.png" -f $size)) -Force
  }
  if ($size -eq 512) {
    Copy-Item $dest (Join-Path $buildRoot 'icon.png') -Force
    Copy-Item $dest (Join-Path $publicDir 'icon-512.png') -Force
    Copy-Item $dest (Join-Path (Split-Path $publicDir -Parent) 'brand\\app-icon.png') -Force
  }
  $bmp.Dispose()
}
$img.Dispose()
Write-Output 'pngs-ok'
`;

const resize = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
if (resize.status !== 0) {
  console.error(resize.stderr || resize.stdout);
  process.exit(resize.status ?? 1);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = icoSizes.map((s) => readFileSync(resolve(out, 'icons', `${s}x${s}.png`)));
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
const bodies = [];
icoSizes.forEach((s, i) => {
  const data = pngs[i];
  const e = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, e);
  header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(data.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += data.length;
  bodies.push(data);
});
writeFileSync(resolve(out, 'icon.ico'), Buffer.concat([header, ...bodies]));
console.log('icons written to', out);
