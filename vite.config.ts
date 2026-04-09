import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core in its own chunk (cached across deployments)
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Heavy chart lib only loaded when StockDetail or charts view is used
          'vendor-charts': ['lightweight-charts'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  // In dev: (1) `npm run dev` → Express+Vite on 5174 (do not start standalone `vite` — same port).
  // (2) Split: `npm run dev:server` (3001) + `vite` (5174, proxy /api → 3001).
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        proxyTimeout: 600000, // 10 min for long-running endpoints (e.g. retro learning)
      },
    },
  },
})
