import { createRequire } from 'node:module';
import { copyFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require('electron-builder');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const releaseDir = fileURLToPath(new URL('../release/', import.meta.url));

function removePreviousBuilds(currentVersion) {
  let names;
  try {
    names = readdirSync(releaseDir);
  } catch {
    return;
  }
  const token = currentVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const current = new RegExp(`(?:^|[.-])${token}(?:[.-]|$)`);
  for (const name of names) {
    if (!/^ApplyFlow[-.]/i.test(name) || current.test(name)) continue;
    rmSync(path.join(releaseDir, name), { force: true });
  }
}

removePreviousBuilds(version);

/** Cursor (or a running app) can lock release/win-unpacked. Package beside it, then copy the installers back. */
function packagingOutput() {
  try {
    rmSync(path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar'), { force: true });
    return null;
  } catch (error) {
    if (error && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')) return path.join(releaseDir, 'pack');
    return null;
  }
}

const output = packagingOutput();
if (process.platform === 'linux') {
  const { WineVmManager } = require('app-builder-lib/out/vm/WineVm');
  const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const original = WineVmManager.prototype.exec;
  WineVmManager.prototype.exec = function (file, args, options, log) {
    if (path.basename(file) === `ApplyFlow-Setup-${version}.exe` && args.length === 0 && options?.env?.__COMPAT_LAYER === 'RunAsInvoker') {
      return UninstallerReader.exec(file, file.replace(/\.exe$/i, '.__uninstaller.exe')).then(() => '');
    }
    return original.call(this, file, args, options, log);
  };
}
await build({
  targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
  ...(output ? { config: { directories: { output } } } : {}),
});
if (output) {
  for (const name of readdirSync(output)) {
    if (!/^ApplyFlow[-.]/i.test(name)) continue;
    copyFileSync(path.join(output, name), path.join(releaseDir, name));
  }
  rmSync(output, { recursive: true, force: true });
}
