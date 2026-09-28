import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_DEMO=true arma la vista previa sin servidor (API simulada en el navegador).
const demo = process.env.VITE_DEMO === 'true';

export default defineConfig({
  plugins: [react()],
  base: demo ? './' : '/',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2022',
    sourcemap: !demo,
    outDir: demo ? 'dist-demo' : 'dist',
    rollupOptions: demo ? { output: { inlineDynamicImports: true } } : undefined,
  },
});
