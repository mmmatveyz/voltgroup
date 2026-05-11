self.addEventListener('install', (event) => {
    console.log('Service Worker installed.');
});

self.addEventListener('fetch', (event) => {
    // Просто пропускаем запросы, не кэшируем пока, чтобы не было ошибок
});