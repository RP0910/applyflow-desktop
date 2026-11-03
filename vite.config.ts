import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * The ApplyFlow window (React). Served to Electron from dist/renderer through the app:// protocol.
 * Electron's main process and preloads are built by scripts/build.mjs.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  base: '',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html') },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
