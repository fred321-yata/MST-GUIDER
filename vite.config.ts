import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite setup for the web build (and the Android/Capacitor bundle).
 *
 * `base: './'` for production builds: the emitted HTML then points at
 * `./assets/...` instead of `/assets/...`, so the site runs whether it is
 * hosted at the domain root (Netlify/Vercel/custom domain), inside a subfolder
 * (GitHub Pages project sites, /app/ previews) or from the Capacitor webView.
 * The dev server keeps '/' so localhost URLs and selftest.html stay stable.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
}))
