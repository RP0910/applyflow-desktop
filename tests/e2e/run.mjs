/** Builds and runs the trusted-input driver. Development only. */
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, '.dist');
const result = process.argv[2] || join(out, 'result.json');
mkdirSync(out, { recursive: true });

const alias = { '@': resolve(root, 'src') };
await build({
  configFile: false,
  logLevel: 'warn',
  resolve: { alias },
  publicDir: false,
  build: {
    outDir: out,
    emptyOutDir: true,
    target: 'chrome140',
    lib: { entry: join(here, 'page.ts'), formats: ['iife'], name: 'ApplyFlowTrustedPage', fileName: () => 'page.js' },
  },
});
await build({
  configFile: false,
  logLevel: 'warn',
  resolve: { alias },
  publicDir: false,
  build: {
    outDir: out,
    emptyOutDir: false,
    target: 'node22',
    ssr: join(here, 'driver.ts'),
    rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'driver.cjs', inlineDynamicImports: true } },
  },
  ssr: { noExternal: true, target: 'node' },
});
cpSync(join(here, 'fixture.html'), join(out, 'fixture.html'));

const electronPath = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, [join(out, 'driver.cjs'), result], { env, stdio: 'inherit' });
const code = await new Promise((resolveExit) => child.on('exit', resolveExit));
process.exit(code ?? 1);
