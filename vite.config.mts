import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true
  }
});
