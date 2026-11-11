/**
 * VoltGroup — Общая конфигурация фронтенда
 * Единый источник адреса бэкенда и реквизитов компании для клиентского кабинета,
 * калькулятора сметы, генераторов документов и форм заявок.
 * 
 * При смене адреса API обновить VG_API и директиву connect-src в CSP заголовках страниц.
 * При смене реквизитов/контактов обновить VG_COMPANY — изменения автоматически
 * применяются во всех 4 документах (смета, КП, акт, договор) и клиентском кабинете.
 */
(function () {
    const root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);

    root.VG_API = 'https://voltgroup-bot.onrender.com';

    root.VG_COMPANY = {
        name: 'Зрячих Матвей Олегович',
        shortName: 'Зрячих М.О.',
        status: 'Плательщик НПД (самозанятый)',
        inn: '591110297727',
        phone: '+7 (905) 208-42-84',
        phoneRaw: '+79052084284',
        telegram: 'https://t.me/voltgroup_spb',
        telegramUser: 'voltgroup_spb',
        vk: 'https://vk.com/voltgroup_spb',
        site: 'voltgroup-spb.ru',
        siteUrl: 'https://voltgroup-spb.ru',
        region: 'Санкт-Петербург и ЛО',
        city: 'г. Санкт-Петербург',
        brandName: 'VoltGroup'
    };

    /**
     * Ранний фоновый прогрев бэкенда Render при первом взаимодействии с сайтом.
     * Запускается при первом скролле, касании экрана или через 3 секунды после открытия.
     * Предотвращает задержки и обрыв заявок из-за холодного старта контейнера на Render.
     */
    let _pingSent = false;
    function pingBackend() {
        if (_pingSent) return;
        _pingSent = true;
        try {
            if (typeof fetch === 'function' && root.VG_API) {
                fetch(root.VG_API + '/ping', { method: 'GET', keepalive: true }).catch(() => {});
            }
        } catch (e) {}
    }
    root.VG_PING_BACKEND = pingBackend;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const opts = { once: true, passive: true };
        window.addEventListener('scroll', pingBackend, opts);
        window.addEventListener('touchstart', pingBackend, opts);
        window.addEventListener('mousemove', pingBackend, opts);
        setTimeout(pingBackend, 3000);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            VG_API: root.VG_API,
            VG_COMPANY: root.VG_COMPANY,
            VG_PING_BACKEND: root.VG_PING_BACKEND
        };
    }
})();
