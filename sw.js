// Service Worker — cachea el shell de la app para instalación PWA
const CACHE = 'finlock-mobile-v1'
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/crypto.js',
  '/js/drive.js',
  '/js/queries.js',
  '/js/app.js',
  '/manifest.json'
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  // Nunca cachear llamadas a APIs externas
  const url = e.request.url
  if (url.includes('googleapis.com') ||
      url.includes('accounts.google.com') ||
      url.includes('cdnjs.cloudflare.com')) return

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  )
})
