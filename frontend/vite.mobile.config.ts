import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const frontendRoot = import.meta.dirname;

export default defineConfig({
  root: resolve(frontendRoot, 'mobile'),
  base: '/phone-assets/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
  build: {
    outDir: resolve(frontendRoot, 'dist-phone'),
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
  },
});
