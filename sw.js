// Service Worker отключен для режима разработки
// Чтобы включить кеширование, раскомментируйте код ниже

/*
const CACHE_NAME = 'voltgroup-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/static/css/style.css',
  '/static/data/prices.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
*/