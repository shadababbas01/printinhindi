import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

// GitHub Pages serves a project (non-custom-domain) site under
// /<repo-name>/, not the domain root — every asset/HTML reference needs
// that prefix or the deployed page loads a blank white screen. Only the
// GitHub Pages CI workflow sets GITHUB_PAGES=true; every other build
// (local dev, Cloudflare Pages, a future custom domain) stays at root.
const base = process.env.GITHUB_PAGES === 'true' ? '/printinhindi/' : '/';

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        about: resolve(__dirname, 'about.html'),
        contact: resolve(__dirname, 'contact.html'),
        pricing: resolve(__dirname, 'pricing.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        'refund-policy': resolve(__dirname, 'refund-policy.html'),
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'हिंदी रजिस्ट्री प्रिंट टूल — Hindi Registry Print Tool',
        short_name: 'Registry Print',
        description: 'Load, convert (incl. Kruti Dev/Devlys) and print Hindi registry documents on legal stamp paper.',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        // Relative, not absolute — works whether the app is served from the
        // domain root or a GitHub Pages subpath like /printinhindi/.
        start_url: '.',
        scope: '.',
        icons: [
          // TODO: replace with real 192/512 PNG icons before production build —
          // these are placeholders so the manifest validates during local dev.
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Never cache payment/checkout traffic or authenticated API responses —
        // only the static app shell (spec section 35).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.hostname.includes('cashfree.com'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
});
