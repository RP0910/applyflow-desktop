/** Build Windows artifacts. Linux uses Electron Builder's own NSIS binary reader
 * to extract the uninstaller, avoiding execution of a Windows helper under Wine.
 * This is the same reader Electron Builder uses on macOS. Windows builds use
 * the regular implementation. No dependency source files are modified.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require('electron-builder');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
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
await build({ targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64) });
