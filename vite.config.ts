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
  // In dev we run via Express + Vite middleware (npm run dev), so no standalone server here.
  server: {
    port: 5173,
  },
})
