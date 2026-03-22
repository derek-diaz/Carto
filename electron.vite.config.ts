// @ts-nocheck
import path from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    ssr: {
      external: ['@eclipse-zenoh/zenoh-ts']
    },
    optimizeDeps: {
      exclude: ['@eclipse-zenoh/zenoh-ts']
    },
    build: {
      sourcemap: true,
      outDir: 'out/main',
      rollupOptions: {
        external: ['@eclipse-zenoh/zenoh-ts'],
        input: path.resolve(__dirname, 'apps/desktop/src/main/main.ts')
      }
    }
  },
  preload: {
    build: {
      sourcemap: true,
      outDir: 'out/preload',
      rollupOptions: {
        input: path.resolve(__dirname, 'apps/desktop/src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname, 'apps/web'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'packages/core/src/shared'),
        '@core': path.resolve(__dirname, 'packages/core/src')
      }
    },
    server: {
      port: 5173,
      strictPort: true
    },
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'apps/web/index.html')
      }
    }
  }
});
