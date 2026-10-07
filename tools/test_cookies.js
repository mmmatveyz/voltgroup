/**
 * tools/test_cookies.js
 * Автоматический тест для модуля static/js/cookies.js и проверки согласия cookies (Задача 021 / Пункт № 12 AUDIT.md)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS: ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL: ${message}`);
    }
}

console.log('--- Тестирование модуля cookies.js и согласия на cookies ---');

// 1. Проверка существования и содержимого static/js/cookies.js
const cookiesJsPath = path.join(rootDir, 'static', 'js', 'cookies.js');
assert(fs.existsSync(cookiesJsPath), 'Файл static/js/cookies.js существует');

const cookiesJsContent = fs.readFileSync(cookiesJsPath, 'utf-8');
assert(cookiesJsContent.includes("const CONSENT_KEY = 'vg_consent'"), 'CONSENT_KEY задан как vg_consent');
assert(cookiesJsContent.includes('const YM_ID = 108492681'), 'Идентификатор счетчика YM_ID = 108492681');
assert(cookiesJsContent.includes('window.resetCookieConsent'), 'Экспортирована функция resetCookieConsent');
assert(cookiesJsContent.includes('vg-cookie-banner'), 'Присутствует верстка баннера с ID vg-cookie-banner');
assert(cookiesJsContent.includes('vg-cookie-accept-all'), 'Присутствует кнопка согласия Принять все');
assert(cookiesJsContent.includes('vg-cookie-accept-necessary'), 'Присутствует кнопка Только необходимые');

// 2. Проверка всех 10 HTML-страниц: отсутствие безусловной инициализации Метрики и наличие cookies.js
const htmlFiles = [
    { file: 'index.html', scriptRel: './static/js/cookies.js' },
    { file: 'estimate.html', scriptRel: './static/js/cookies.js' },
    { file: 'works.html', scriptRel: './static/js/cookies.js' },
    { file: 'privacy.html', scriptRel: './static/js/cookies.js' },
    { file: 'offer.html', scriptRel: './static/js/cookies.js' },
    { file: 'cookies.html', scriptRel: './static/js/cookies.js' },
    { file: '404.html', scriptRel: './static/js/cookies.js' },
    { file: 'install/index.html', scriptRel: '../static/js/cookies.js' },
    { file: 'engineering/index.html', scriptRel: '../static/js/cookies.js' },
    { file: 'contacts/index.html', scriptRel: '../static/js/cookies.js' },
];

for (const item of htmlFiles) {
    const fullPath = path.join(rootDir, item.file);
    assert(fs.existsSync(fullPath), `Файл ${item.file} существует`);
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Проверяем, что нет безусловной инициализации ym(108492681, 'init', ...)
    const hasUnconditionalYm = /ym\(\s*108492681\s*,\s*['"]init['"]/.test(content);
    assert(!hasUnconditionalYm, `${item.file}: безусловный вызов ym(108492681, 'init') удалён`);

    // Проверяем подключение cookies.js
    const hasScriptTag = content.includes(item.scriptRel);
    assert(hasScriptTag, `${item.file}: содержит подключение ${item.scriptRel}`);
}

// 3. Проверка интерактивного блока управления cookies на cookies.html
const cookiesHtmlContent = fs.readFileSync(path.join(rootDir, 'cookies.html'), 'utf-8');
assert(cookiesHtmlContent.includes('id="btn-cookie-settings"'), 'cookies.html содержит кнопку btn-cookie-settings');
assert(cookiesHtmlContent.includes('id="cookie-status-text"'), 'cookies.html содержит индикатор cookie-status-text');

// 4. Проверка стилей баннера в static/css/style.css
const styleCssPath = path.join(rootDir, 'static', 'css', 'style.css');
const styleCssContent = fs.readFileSync(styleCssPath, 'utf-8');
assert(styleCssContent.includes('.cookie-banner'), 'style.css содержит класс .cookie-banner');
assert(styleCssContent.includes('.cookie-banner.visible'), 'style.css содержит класс анимации .cookie-banner.visible');
assert(styleCssContent.includes('.cookie-banner-actions'), 'style.css содержит стили кнопок .cookie-banner-actions');

console.log(`\nИтог тестов cookies: Пройдено: ${passedTests}, Ошибок: ${failedTests}, Всего: ${totalTests}`);
if (failedTests > 0) {
    process.exit(1);
}
