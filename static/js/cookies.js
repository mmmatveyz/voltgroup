/**
 * cookies.js — Управление согласием на файлы cookie и отложенная инициализация Яндекс.Метрики
 *
 * VoltGroup (https://voltgroup-spb.ru)
 * Соответствие 152-ФЗ: аналитические счетчики с вебвизором не запускаются
 * до явного подтверждения пользователя.
 */

(function () {
    'use strict';

    const CONSENT_KEY = 'vg_consent';
    const YM_ID = 108492681;

    /**
     * Динамическая инициализация счётчика Яндекс.Метрики
     */
    function initMetrika() {
        if (window.__vg_ym_inited) {
            return;
        }
        window.__vg_ym_inited = true;

        (function (m, e, t, r, i, k, a) {
            m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
            m[i].l = 1 * new Date();
            for (var j = 0; j < document.scripts.length; j++) {
                if (document.scripts[j].src === r) { return; }
            }
            k = e.createElement(t);
            a = e.getElementsByTagName(t)[0];
            k.async = 1;
            k.src = r;
            if (a && a.parentNode) {
                a.parentNode.insertBefore(k, a);
            } else {
                (document.head || document.documentElement).appendChild(k);
            }
        })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + YM_ID, 'ym');

        if (typeof window.ym === 'function') {
            window.ym(YM_ID, 'init', {
                ssr: true,
                webvisor: true,
                clickmap: true,
                ecommerce: 'dataLayer',
                referrer: document.referrer,
                url: location.href,
                accurateTrackBounce: true,
                trackLinks: true
            });
        }
    }

    /**
     * Чтение сохранённого статуса согласия
     * @returns {'all' | 'necessary' | null}
     */
    function getConsent() {
        try {
            return localStorage.getItem(CONSENT_KEY);
        } catch (e) {
            return null;
        }
    }

    /**
     * Сохранение статуса согласия
     * @param {'all' | 'necessary'} value
     */
    function setConsent(value) {
        try {
            localStorage.setItem(CONSENT_KEY, value);
        } catch (e) {}
    }

    /**
     * Сброс статуса согласия
     */
    function removeConsent() {
        try {
            localStorage.removeItem(CONSENT_KEY);
        } catch (e) {}
    }

    /**
     * Определение корректной относительной ссылки на cookies.html
     */
    function getPolicyUrl() {
        const path = window.location.pathname || '';
        if (path.includes('/install/') || path.includes('/engineering/') || path.includes('/contacts/') || path.includes('/client/')) {
            return '../cookies.html';
        }
        return './cookies.html';
    }

    /**
     * Обновление статуса в блоке настроек на странице cookies.html (если присутствует)
     */
    function updatePageStatus(consent) {
        const statusEl = document.getElementById('cookie-status-text');
        if (!statusEl) return;

        if (consent === 'all') {
            statusEl.textContent = 'Разрешены все (включая веб-аналитику)';
            statusEl.style.color = 'var(--primary-install, #00f0ff)';
        } else if (consent === 'necessary') {
            statusEl.textContent = 'Только технически необходимые';
            statusEl.style.color = 'var(--text-muted, #8a99ad)';
        } else {
            statusEl.textContent = 'Не задан (баннер открыт)';
            statusEl.style.color = '#ffb800';
        }
    }

    /**
     * Скрытие баннера
     */
    function hideBanner() {
        const banner = document.getElementById('vg-cookie-banner');
        if (!banner) return;
        banner.classList.remove('visible');
        setTimeout(() => {
            if (banner.parentNode) {
                banner.parentNode.removeChild(banner);
            }
        }, 360);
    }

    /**
     * Отрисовка и показ баннера согласия
     */
    function showBanner() {
        if (document.getElementById('vg-cookie-banner')) {
            const existing = document.getElementById('vg-cookie-banner');
            existing.classList.add('visible');
            const acceptBtn = document.getElementById('vg-cookie-accept-all');
            if (acceptBtn) acceptBtn.focus();
            return;
        }

        const policyUrl = getPolicyUrl();
        const banner = document.createElement('div');
        banner.id = 'vg-cookie-banner';
        banner.className = 'cookie-banner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Согласие на использование файлов cookie');

        banner.innerHTML = `
            <div class="cookie-banner-content">
                <div class="cookie-banner-text">
                    <span>Мы используем файлы cookie и Яндекс.Метрику для правильной работы сайта и аналитики. Подробнее — в <a href="${policyUrl}" class="cookie-banner-link">Политике cookies</a>.</span>
                </div>
                <div class="cookie-banner-actions">
                    <button type="button" id="vg-cookie-accept-all" class="btn btn-primary cookie-btn">Принять все</button>
                    <button type="button" id="vg-cookie-accept-necessary" class="btn btn-outline cookie-btn">Только необходимые</button>
                </div>
            </div>
        `;

        document.body.appendChild(banner);

        // Плавное появление
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                banner.classList.add('visible');
            });
        });

        // Навешивание обработчиков
        const btnAll = document.getElementById('vg-cookie-accept-all');
        const btnNecessary = document.getElementById('vg-cookie-accept-necessary');

        if (btnAll) {
            btnAll.addEventListener('click', () => {
                setConsent('all');
                hideBanner();
                initMetrika();
                updatePageStatus('all');
                try {
                    window.dispatchEvent(new CustomEvent('vg:consent', { detail: { consent: 'all' } }));
                } catch (e) {}
            });
        }

        if (btnNecessary) {
            btnNecessary.addEventListener('click', () => {
                setConsent('necessary');
                hideBanner();
                updatePageStatus('necessary');
                try {
                    window.dispatchEvent(new CustomEvent('vg:consent', { detail: { consent: 'necessary' } }));
                } catch (e) {}
            });
        }
    }

    /**
     * Сброс настроек согласия (для страницы cookies.html)
     */
    function resetCookieConsent() {
        removeConsent();
        updatePageStatus(null);
        showBanner();
    }

    /**
     * Инициализация логики при загрузке страницы
     */
    function init() {
        const consent = getConsent();

        if (consent === 'all') {
            initMetrika();
        } else if (consent === 'necessary') {
            // Аналитику не запускаем
        } else {
            showBanner();
        }

        updatePageStatus(consent);

        // Слушатель для кнопки смены настроек на странице cookies.html
        const settingsBtn = document.getElementById('btn-cookie-settings');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                resetCookieConsent();
            });
        }
    }

    // Экспорт в глобальное пространство
    window.VG_CONSENT = {
        get: getConsent,
        set: setConsent,
        reset: resetCookieConsent,
        initMetrika: initMetrika
    };
    window.resetCookieConsent = resetCookieConsent;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
