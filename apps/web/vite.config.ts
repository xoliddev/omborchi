import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `--mode demo` builds the GitHub Pages demo: the API runs in a Web Worker against PGlite.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/omborchi/' : '/',
  plugins: [react()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  preview: { port: 4173 },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
}));
