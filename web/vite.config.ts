import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // navigateFallbackDenylist: the APK download is a navigation too; without this the
      // service worker answered it with index.html and phones got an "APK" that will not parse.
      workbox: { skipWaiting: true, clientsClaim: true, navigateFallbackDenylist: [/^\/download\//, /^\/api\//, /^\/healthz/] },
      includeAssets: ['favicon.ico', 'favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Ah-Ha',
        short_name: 'Ah-Ha',
        description: 'Your personal knowledge space',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    allowedHosts: ['gmk.local', 'mini.local', 'localhost'],
    proxy: {
      '/api': 'http://localhost:3100',
      '/auth/magic-link': 'http://localhost:3100',
      '/auth/pow-challenge': 'http://localhost:3100',
      '/auth/claim-username': 'http://localhost:3100',
      '/auth/dev-link': 'http://localhost:3100',
      '/auth/logout': 'http://localhost:3100',
      '/auth/me': 'http://localhost:3100',
    },
  },
})
