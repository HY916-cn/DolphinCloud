// npm run build: Workbox writes dist/sw.js (PHASE-1.md §7.7). The app shell and its fonts are precached so the
// counter opens without a network; the API is never cached, except /config.js (the site's public anon key),
// kept as a fallback for when the counter starts offline.
module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['index.html', '_expo/**/*.{js,css}', 'logo.png', 'favicon.ico', 'manifest.webmanifest', 'fonts/fonts.css', 'fonts/nunito-sans/*-latin-wght-normal.woff2'],
  swDest: 'dist/sw.js',
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/(auth|rest|storage)\//, /^\/config\.js$/],
  runtimeCaching: [
    { urlPattern: /\/config\.js$/, handler: 'NetworkFirst', options: { cacheName: 'config', networkTimeoutSeconds: 3 } },
    // Other font slices (Chinese and the rest) are fetched only as pages need them, then kept; their names carry no
    // version, so a kept slice is checked again in the background and a new font arrives on the next load.
    { urlPattern: /\/fonts\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts' } },
  ],
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
};
