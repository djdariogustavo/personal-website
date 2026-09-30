import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_DEMO=true arma la vista previa sin servidor (API simulada en el navegador).
const demo = process.env.VITE_DEMO === 'true';
// El SDK de escaneo real usa SharedArrayBuffer: en desarrollo también hace falta el aislamiento de origen.
const aislamiento = process.env.VITE_SCAN_PROVIDER === 'sdk' ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : undefined;

export default defineConfig({
  plugins: [react()],
  base: demo ? './' : '/',
  server: {
    port: 5173,
    headers: aislamiento,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2022',
    sourcemap: !demo,
    outDir: demo ? 'dist-demo' : 'dist',
    rollupOptions: demo ? { output: { inlineDynamicImports: true } } : undefined,
  },
});
