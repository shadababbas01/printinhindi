import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';

// GitHub Pages serves a project (non-custom-domain) site under
// /<repo-name>/, not the domain root — every asset/HTML reference needs
// that prefix or the deployed page loads a blank white screen. Only the
// GitHub Pages CI workflow sets GITHUB_PAGES=true; every other build
// (local dev, Cloudflare Pages, a future custom domain) stays at root.
const base = process.env.GITHUB_PAGES === 'true' ? '/printinhindi/' : '/';

// vite-plugin-pwa injects its <link rel="manifest"> + register-SW <script>
// into every HTML entry point, not just index.html — and it does this via
// its own late generateBundle hook (after transformIndexHtml has already
// run), so stripping it from transformIndexHtml is too early: the tags
// don't exist yet at that point. On iOS 16.4+, "Add to Home Screen" reads
// that manifest's start_url ('.', which resolves against the manifest's OWN
// location — the site root) instead of the page you were actually on, so
// saving admin.html to the Home Screen silently opened the main app
// instead. Only index.html is meant to be the installable PWA; strip the
// injected tags back out of every other page's final HTML output.
function stripPwaFromSecondaryPages() {
  return {
    name: 'strip-pwa-injection-from-secondary-pages',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (!fileName.endsWith('.html') || fileName === 'index.html' || asset.type !== 'asset') continue;
        asset.source = String(asset.source)
          .replace(/<link rel="manifest"[^>]*>/, '')
          .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, '');
      }
    },
  };
}

// Minification alone (Vite's default) keeps logic trivially readable once
// reformatted in DevTools — variable/function names survive, just short.
// This renames identifiers to hex, splits/encodes string literals into a
// shuffled lookup array, and adds light control-flow obfuscation, so
// opening DevTools shows unreadable noise instead of near-original source.
// This is a deterrent against casual copying, NOT a security boundary —
// nothing here should ever substitute for keeping real secrets and
// authorization checks server-side (which this app already does).
function obfuscateOwnCode() {
  return {
    name: 'obfuscate-own-code',
    apply: 'build',
    renderChunk(code, chunk) {
      if (!chunk.fileName.endsWith('.js')) return null;
      const result = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.3,
        deadCodeInjection: false,
        stringArray: true,
        stringArrayThreshold: 0.75,
        stringArrayEncoding: ['base64'],
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        selfDefending: false,
        disableConsoleOutput: false,
      });
      return { code: result.getObfuscatedCode(), map: null };
    },
  };
}

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
    stripPwaFromSecondaryPages(),
    obfuscateOwnCode(),
  ],
});
