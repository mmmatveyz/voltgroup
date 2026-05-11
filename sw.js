const CACHE_NAME = 'voltgroup-v3';

// Кэшируем только наши файлы
const urlsToCache = [
  '/',
  '/index.html',
  '/estimate.html',
  '/works.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Установка: кэшируем статику
self.addEventListener('install', event => {
  console.log('🔄 Installing Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Кэшируем:', urlsToCache);
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.log('❌ Ошибка кэширования:', err))
  );
});

// Активация: чистим старый кэш
self.addEventListener('activate', event => {
  console.log('✅ Service Worker активирован');
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('🗑 Удаляем старый кэш:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => clients.claim())
  );
});

// Стратегия: Кэш для своих, сеть для чужих
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  
  // Игнорируем внешние запросы (Яндекс.Метрика, Telegram API и т.д.)
  if (requestUrl.origin !== location.origin) {
    return; // Просто пропускаем, не кэшируем и не обрабатываем
  }
  
  // Игнорируем не-GET запросы (формы, посты)
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Если есть в кэше — отдаем сразу
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Если нет — идем в сеть
        return fetch(event.request)
          .then(networkResponse => {
            // Проверяем, что ответ валиден
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // Клонируем ответ для кэширования
            const responseToCache = networkResponse.clone();
            
            // Сохраняем в кэш (без ошибок, если не получится)
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache)
                  .catch(err => console.log('⚠️ Не удалось закэшировать:', err));
              });
            
            return networkResponse;
          })
          .catch(error => {
            // Если офлайн и нет в кэше — показываем заглушку для навигации
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            // Для остальных запросов просто возвращаем ошибку
            console.log('🌐 Запрос не удался (офлайн?):', error);
          });
      })
  );
});
