import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Port 5175: stock-screener dev uses 5174 for Express+Vite — avoid collision when both run locally.
  server: {
    port: 5175,
    strictPort: true,
    // Bind IPv4 so http://127.0.0.1:5175 matches the stock-screener header link on macOS (Vite’s default can be IPv6-only).
    host: '127.0.0.1',
    // Allow embedding in stock-screener at /ai-hedge-fund (origin http://127.0.0.1:5174 / localhost:5174).
    headers: {
      'Content-Security-Policy':
        "frame-ancestors 'self' http://127.0.0.1:5174 http://localhost:5174",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
