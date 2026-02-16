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
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to backend so we don't expose Massive API key
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
