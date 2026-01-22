import path from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const mainEntry = path.resolve(__dirname, 'src/main/main.ts');
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
        input: mainEntry
      }
    }
  },
  preload: {
    build: {
      sourcemap: true,
      outDir: 'out/preload',
      rollupOptions: {
        input: path.resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared')
      }
    },
    server: {
      port: 5173,
      strictPort: true
    },
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      emptyOutDir: true
    }
  }
});
