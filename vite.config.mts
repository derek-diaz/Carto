import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, 'apps/web'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/web/src'),
      '@assets': path.resolve(__dirname, 'assets'),
      '@shared': path.resolve(__dirname, 'packages/core/src/shared'),
      '@core': path.resolve(__dirname, 'packages/core/src')
    }
  },
  publicDir: path.resolve(__dirname, 'assets/web'),
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true
  }
});
