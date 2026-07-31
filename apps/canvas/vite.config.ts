import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // V1.1 M2 (F5): proxy the execution-monitor WebSocket to the API.
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
      '/ready': { target: 'http://localhost:3000', changeOrigin: true },
      '/metrics': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
