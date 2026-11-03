// Builds ApplyFlow Desktop:
//   1. the window (React)                      → dist/renderer/
//   2. Electron main process                   → dist-electron/main.cjs
//   3. window preload (bridge)                 → dist-electron/preload.cjs
//   4. Dice page helper preload                → dist-electron/dice-preload.cjs
//   5. Dice page-world file-chooser helper     → dist-electron/main-world.js
//   6. command-line resume renderer (no AI)    → dist-cli/applyflow-render.mjs
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const alias = { '@': resolve(root, 'src') };
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const nodeExternals = ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const pkgVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const srcVersion = readFileSync(resolve(root, 'src/version.ts'), 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1];
if (srcVersion !== pkgVersion) throw new Error(`src/version.ts (${srcVersion}) doesn't match package.json (${pkgVersion}).`);

/** A single-file CommonJS bundle for Electron (main or a sandboxed preload). */
const electronBundle = (entry, fileName, target = 'node22') =>
  build({
    configFile: false,
    logLevel: 'warn',
    resolve: { alias },
    publicDir: false,
    build: {
      outDir: resolve(root, 'dist-electron'),
      emptyOutDir: false,
      target,
      minify: false,
      ssr: resolve(root, entry),
      rollupOptions: { external: nodeExternals, output: { format: 'cjs', entryFileNames: fileName, inlineDynamicImports: true } },
    },
    ssr: { noExternal: true, target: 'node' },
  });

async function run() {
  if (!only || only === 'renderer') await build({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' });
  if (!only || only === 'electron') {
    rmSync(resolve(root, 'dist-electron'), { recursive: true, force: true });
    await electronBundle('electron/main.ts', 'main.cjs');
    await electronBundle('electron/preload.ts', 'preload.cjs');
    await electronBundle('electron/dicePreload.ts', 'dice-preload.cjs', 'chrome140');
    await build({
      configFile: false,
      logLevel: 'warn',
      resolve: { alias },
      publicDir: false,
      build: {
        outDir: resolve(root, 'dist-electron'),
        emptyOutDir: false,
        target: 'chrome140',
        lib: { entry: resolve(root, 'src/content/mainWorld.ts'), formats: ['iife'], name: 'ApplyFlowMainWorld', fileName: () => 'main-world.js' },
      },
    });
  }
  if (!only || only === 'cli') {
    await build({
      configFile: false,
      logLevel: 'warn',
      resolve: { alias },
      publicDir: false,
      build: {
        outDir: resolve(root, 'dist-cli'),
        emptyOutDir: true,
        target: 'node22',
        ssr: resolve(root, 'scripts/applyflow-render.ts'),
        rollupOptions: { external: nodeExternals, output: { format: 'es', entryFileNames: 'applyflow-render.mjs', inlineDynamicImports: true } },
      },
      ssr: { noExternal: true, target: 'node' },
    });
    mkdirSync(resolve(root, 'dist-cli/fonts'), { recursive: true });
    cpSync(resolve(root, 'public/fonts'), resolve(root, 'dist-cli/fonts'), { recursive: true });
  }
  console.log(`ApplyFlow Desktop v${pkgVersion} built.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
