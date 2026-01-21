import path from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const mainEntry = path.resolve(__dirname, 'src/main/main.ts');
const tapEntry = path.resolve(__dirname, 'src/main/zenoh/carto-tap.ts');

export default defineConfig({
  main: {
    entry: mainEntry,
    vite: {
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
          input: {
            main: mainEntry,
            'carto-tap': tapEntry
          }
        }
      }
    }
  },
  preload: {
    input: {
      index: path.resolve(__dirname, 'src/preload/index.ts')
    },
    vite: {
      build: {
        sourcemap: true,
        outDir: 'out/preload'
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
