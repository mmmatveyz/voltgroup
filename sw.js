const CACHE_NAME = 'voltgroup-v2';

// Файлы для кэширования при установке
const urlsToCache = [
    '/',
    '/index.html',
    '/estimate.html',          // Калькулятор - самое важное!
    '/works.html',
    '/manifest.json',
    '/favicon.ico'
    // Добавь сюда другие файлы если нужно
];

// Установка SW и кэширование
self.addEventListener('install', event => {
    console.log('🔄 Installing Service Worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
            console.log('📦 Кэшируем файлы:', urlsToCache);
            return cache.addAll(urlsToCache);
        })
            .then(() => self.skipWaiting())
    );
});

// Активация и очистка старого кэша
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

// Стратегия: Сначала кэш, потом сеть (Cache First)
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
            // Если есть в кэше - отдаем сразу
            if (response) {
                return response;
            }

            // Если нет в кэше - идем в сеть
            return fetch(event.request)
                .then(response => {
                // Если ответ не валиден - возвращаем ошибку
                if(!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                // Клонируем ответ
                const responseToCache = response.clone();

                // Сохраняем в кэш для будущих запросов
                caches.open(CACHE_NAME)
                    .then(cache => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            })
                .catch(error => {
                console.log('❌ Ошибка загрузки:', error);
                // Если офлайн и нет в кэше - показываем заглушку
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});