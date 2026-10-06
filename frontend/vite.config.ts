import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const api = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } }

// Same policy as vercel.json, so `npm run build && npm run preview` catches anything
// the production CSP would block.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: api },
  build: {
    rolldownOptions: {
      output: {
        // Leaflet changes less often than the app, so it gets its own cacheable file.
        // The PDF libraries load on demand and are already split by their dynamic import.
        codeSplitting: {
          groups: [{ name: 'leaflet', test: /node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/ }],
        },
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: api,
    headers: {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/**/*.test.*', 'src/test/**'] },
  },
})
