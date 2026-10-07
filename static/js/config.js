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

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            VG_API: root.VG_API,
            VG_COMPANY: root.VG_COMPANY
        };
    }
})();
